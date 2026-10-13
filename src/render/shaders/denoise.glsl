// Edge-aware à-trous filter for display only (SVGF-style). Light reflected by
// the first visible surface is divided by its reflectance before filtering, so
// texture survives; haze from first medium collisions is filtered on its own,
// stopped only by depth discontinuities. Dividing total radiance by albedo would
// imprint surface patterns onto the additive haze.
uniform sampler2D uSurface;
uniform sampler2D uHaze;
uniform sampler2D uGuideGeometry;
uniform sampler2D uGuideAlbedo;
uniform sampler2D uGuideMedium;
uniform mat3 uMaterialXYZ;
uniform vec2 uSize;
uniform float uStride;
uniform float uSamples;
uniform int uMode; // 0: prepare from accumulation, 1: filter step, 2: compose
uniform bool uCloudy;
layout(location=0) out vec4 outSurface;
layout(location=1) out vec4 outHaze;

vec3 reflectance(ivec2 p) {return max(uMaterialXYZ*texelFetch(uGuideAlbedo,p,0).rgb,vec3(0.002));}
float kernel(int i) {return i==0 ? 0.5 : 0.25;}

void main() {
  ivec2 center=ivec2(gl_FragCoord.xy),last=ivec2(uSize)-1;
  if (uMode==2) {
    outSurface=vec4(texelFetch(uSurface,center,0).rgb*reflectance(center)+texelFetch(uHaze,center,0).rgb,1.0);
    outHaze=vec4(0.0);
    return;
  }
  if (uMode==0) {
    // Variance of each pixel mean, from luminance second moments. Over the first
    // few samples a 3 × 3 spatial estimate replaces the unreliable temporal one.
    vec4 total=texelFetch(uSurface,center,0),haze=texelFetch(uHaze,center,0);
    vec3 albedo=reflectance(center);
    vec3 surface=(total.rgb-haze.rgb)/albedo;
    float count=max(uSamples,1.0);
    vec2 variance=vec2(max(0.0,total.a-pow(total.y-haze.y,2.0))/(albedo.y*albedo.y),max(0.0,haze.a-haze.y*haze.y))/count;
    if (uSamples<4.0) {
      vec2 sum=vec2(0.0),squares=vec2(0.0);
      for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++) {
        ivec2 p=clamp(center+ivec2(x,y),ivec2(0),last);
        vec4 otherTotal=texelFetch(uSurface,p,0),otherHaze=texelFetch(uHaze,p,0);
        vec2 value=vec2((otherTotal.y-otherHaze.y)/reflectance(p).y,otherHaze.y);
        sum+=value;squares+=value*value;
      }
      variance=max(variance,max(vec2(0.0),squares/9.0-sum*sum/81.0));
    }
    outSurface=vec4(surface,variance.x);
    outHaze=vec4(haze.rgb,variance.y);
    return;
  }
  vec4 surface=texelFetch(uSurface,center,0),haze=texelFetch(uHaze,center,0);
  vec4 geometry=texelFetch(uGuideGeometry,center,0),domain=texelFetch(uGuideAlbedo,center,0);
  // Pool neighboring uncertainty: a pixel with no successful paths has zero
  // sample variance, not certainty that it is black.
  vec2 variance=vec2(0.0);
  for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++) {
    ivec2 p=clamp(center+ivec2(x,y),ivec2(0),last);
    variance+=kernel(x)*kernel(y)*vec2(texelFetch(uSurface,p,0).a,texelFetch(uHaze,p,0).a);
  }
  float tolerance=max(geometry.a,0.001)*uStride;
  float mediumDepth=texelFetch(uGuideMedium,center,0).r;
  float mediumTolerance=max(mediumDepth,0.001)*uStride;
  // Luminance uses all edge-stopping weights. Chromaticity uses only geometric
  // ones: each sample carries only four wavelengths, so luminance stopping would favor
  // neighbors that sampled similar wavelengths and keep color speckle. The
  // demodulated illumination and the haze both vary slowly in color.
  vec4 surfaceSum=vec4(0.0),hazeSum=vec4(0.0),surfaceWide=vec4(0.0),hazeWide=vec4(0.0);
  vec2 total=vec2(0.0);
  for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++) {
    ivec2 p=clamp(center+ivec2(x,y)*int(uStride),ivec2(0),last);
    vec4 otherGeometry=texelFetch(uGuideGeometry,p,0),otherDomain=texelFetch(uGuideAlbedo,p,0);
    vec4 otherSurface=texelFetch(uSurface,p,0),otherHaze=texelFetch(uHaze,p,0);
    // A zero-contribution pixel is uncertain, not an edge. Include the other
    // pixel's uncertainty even when it lies beyond the center's small pool.
    vec2 sigma=4.0*sqrt(variance+vec2(otherSurface.a,otherHaze.a))+1e-6;
    vec2 signal=vec2(surface.y*surface.y,haze.y*haze.y),otherSignal=vec2(otherSurface.y*otherSurface.y,otherHaze.y*otherHaze.y);
    vec2 confidence=min(signal/(signal+variance+1e-12),otherSignal/(otherSignal+vec2(otherSurface.a,otherHaze.a)+1e-12));
    float k=kernel(x)*kernel(y);
    float depth=abs(otherGeometry.a-geometry.a);
    bool sameDomain=domain.a<0.0 || otherDomain.a<0.0 || abs(otherDomain.a-domain.a)<0.5;
    bool diffuse=(domain.a<2.0 || domain.a>3.5) && (otherDomain.a<2.0 || otherDomain.a>3.5);
    // Crown and roof normals change from pixel to pixel; chromaticity ignores them.
    float surfaceGeometry=sameDomain ? k*exp(-depth/(0.01*tolerance+0.0005)) : 0.0;
    float surfaceDetail=surfaceGeometry*pow(max(0.0,dot(geometry.xyz,otherGeometry.xyz)),32.0);
    // Isolated noisy crowns cannot estimate their illumination from matching
    // normals alone. Borrow diffuse lighting while it is uncertain, then restore
    // normal/material edge stopping as the frozen image gains evidence.
    float diffuseGeometry=k*exp(-depth/(0.05*tolerance+0.002));
    float surfaceWeight=(uCloudy && diffuse ? mix(diffuseGeometry,surfaceDetail,confidence.x) : surfaceDetail)*exp(-confidence.x*abs(otherSurface.y-surface.y)/sigma.x);
    // In-scattered light varies smoothly with path length and direction.
    float volumeDistance=abs(texelFetch(uGuideMedium,p,0).r-mediumDepth);
    float hazeGeometry=k*exp(-volumeDistance/(0.05*mediumTolerance+0.002));
    float hazeWeight=hazeGeometry*exp(-confidence.y*abs(otherHaze.y-haze.y)/sigma.y);
    // Successive à-trous passes reuse overlapping samples. Treating these as
    // independent collapses variance and locks in sparse spectral fireflies.
    surfaceSum+=vec4(surfaceWeight*otherSurface.rgb,surfaceWeight*otherSurface.a);
    hazeSum+=vec4(hazeWeight*otherHaze.rgb,hazeWeight*otherHaze.a);
    // Cloud-lit diffuse materials share a slowly varying illumination color
    // after demodulation. Pool that color across trees/fields/roofs; isolated
    // crown pixels otherwise retain single-wavelength speckles indefinitely.
    // Confident luminance respects normals/material edges; glass and water
    // always keep their own domains.
    float colorGeometry=uCloudy && diffuse ? hazeGeometry : surfaceGeometry;
    surfaceWide+=vec4(otherSurface.rgb,1.0)*colorGeometry;
    hazeWide+=vec4(otherHaze.rgb,1.0)*hazeGeometry;
    total+=vec2(surfaceWeight,hazeWeight);
  }
  vec3 surfaceColor=surfaceWide.rgb/surfaceWide.a,hazeColor=hazeWide.rgb/hazeWide.a;
  float surfaceLuminance=surfaceSum.y/total.x,hazeLuminance=hazeSum.y/total.y;
  outSurface=vec4(surfaceColor*(surfaceLuminance/max(surfaceColor.y,1e-12)),surfaceSum.a/total.x);
  outHaze=vec4(hazeColor*(hazeLuminance/max(hazeColor.y,1e-12)),hazeSum.a/total.y);
}
