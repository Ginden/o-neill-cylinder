uniform mat4 uInverseProjection;
uniform mat4 uCameraMatrix;
uniform vec3 uCameraPosition;
uniform vec2 uResolution;
uniform int uSteps;
uniform int uDiagnostic;
uniform sampler2D uPrevious;
uniform sampler2D uPreviousHaze;
uniform int uHistory;
uniform int uDropletLimit;
uniform bool uCachePass;
uniform int uCacheIteration;
uniform float uCacheBlend;
uniform bool uSurfacePass;
uniform sampler2D uPreviousSurface;
uniform int uSurfaceSample;
uniform int uSurfaceHistory;
uniform vec3 uSolarBands;
// Camera paths end at their second surface in the surface atlas.
uniform bool uSurfaceCache;
// Camera pass: total XYZ with the surface part's luminance second moment, and
// the haze part (first event in the medium) with its own second moment.
// Cache pass: scattered fluence at the node wavelengths, then flux and air fraction.
// Surface pass: irradiance of light that has scattered or reflected at least
// once, per reflectance band (680, 550, 440 nm), relative to sunlight.
layout(location=0) out vec4 outColor;
layout(location=1) out vec4 outHaze;

// Seeds the generator for one pixel or atlas texel and draws its four
// wavelengths. Each covers all hero strata every 41 samples. A stable random
// offset and coprime permutation preserve the uniform spectral estimator.
// Three companions, rotated by 100 nm, are each uniform on 380–780 nm too.
void startSample(uint seed,int index) {
  rngState=seed;
  int offset=int(randomValue()*41.0);
  rngState+=uint(index)*6271u;
  int stratum=(index%41*17+offset)%41;
  float hero=(float(stratum)+randomValue())*(400.0/41.0);
  wavelength=380.0+mod(hero+vec4(0.0,100.0,200.0,300.0),400.0);
  spectralBin=(wavelength-380.0)/10.0;
  prepareWavelength();
}

// One iteration of the scattered-light cache. A path from a uniform point in
// each cell estimates the scattered radiance arriving there from a sampled
// direction; it ends in the previous cache after `uDropletLimit` droplet
// scatterings. Repeating this converges to a fixed point: the cached field
// whose shortened paths reproduce it. The blend averages iterations.
// Returns false when the cell is finished without a path (deep cells).
bool startCachePath(out vec3 origin,out vec3 direction,out float density,out int hero,out bool air) {
  ivec2 texel=ivec2(gl_FragCoord.xy);
  int radial=texel.y%CACHE_RADIAL,axial=texel.y/CACHE_RADIAL;
  rngState=uint(texel.x+texel.y*CACHE_ANGULAR)*9781u+uint(uCacheIteration)*6271u+0x2545f491u;
  randomValue();
  // Deep cells follow the diffusion solve instead.
  if (texelFetch(uCacheDiffusion,texel,0).x>0.0) {
    outColor=texelFetch(uCacheFluence,texel,0);outHaze=texelFetch(uCacheFlux,texel,0);
    return false;
  }
  // Radial bins are uniform in sqrt(depth); sample the bin uniformly by volume.
  float outer=uRadius*(1.0-pow(float(radial)/float(CACHE_RADIAL),2.0));
  float inner=uRadius*(1.0-pow(float(radial+1)/float(CACHE_RADIAL),2.0));
  float radius=sqrt(mix(inner*inner,outer*outer,randomValue()));
  float angle=(float(texel.x)+randomValue())/float(CACHE_ANGULAR)*2.0*PI;
  float z=((float(axial)+randomValue())/float(CACHE_AXIAL)-0.5)*uLength;
  origin=vec3(radius*cos(angle),radius*sin(angle),z);
  float above;
  air=baseDistance(origin,above)>EPS*4.0;
  // Each node wavelength is the hero for a quarter of the paths.
  hero=min(3,int(randomValue()*4.0));
  for (int k=0;k<4;k++) wavelength[k]=CACHE_WAVELENGTHS[(hero+k)%4];
  spectralBin=(wavelength-380.0)/10.0;
  prepareWavelength();
  // Half of the directions are uniform on the sphere, half follow a droplet
  // phase lobe around a random open route to the Sun. Forward-scattered
  // sunlight forms a narrow, very bright halo there: uniform directions alone
  // would find it rarely and with enormous weight. The mixture density keeps
  // the estimate unbiased.
  const float SUN_LOBE=0.5;
  int count;
  vec4 routes=openRoutes(origin,uSun,count);
  if (count>0 && randomValue()<SUN_LOBE) {
    int pick=min(count-1,int(randomValue()*float(count))),source=0;
    for (int i=0;i<4;i++) {
      if (routes[i]>0.0) {
        if (pick==0) {source=i;break;}
        pick--;
      }
    }
    direction=phaseSample(routeDirection(source,uSun),2);
  } else direction=around(vec3(0,0,1),2.0*randomValue()-1.0,2.0*PI*randomValue());
  density=1.0/(4.0*PI);
  if (count>0) {
    float lobe=0.0;
    for (int i=0;i<4;i++) {
      if (routes[i]<=0.0) continue;
      vec4 phase,pdf;
      scatteringPhase(dot(direction,routeDirection(i,uSun)),2,phase,pdf);
      lobe+=pdf.x;
    }
    density=mix(density,lobe/float(count),SUN_LOBE);
  }
  return true;
}

void finishCachePath(vec4 radiance,vec3 direction,float density,int hero,bool air) {
  ivec2 texel=ivec2(gl_FragCoord.xy);
  vec4 previous=texelFetch(uCacheFluence,texel,0),previousFlux=texelFetch(uCacheFlux,texel,0);
  radiance/=blackbody(5772.0)*density;
  vec4 fluence;
  for (int k=0;k<4;k++) fluence[(hero+k)%4]=radiance[k];
  // A numerical failure leaves the cell as it was; it is not evidence of terrain.
  if (any(isnan(fluence)) || any(isinf(fluence))) {outColor=previous;outHaze=previousFlux;return;}
  // Arriving light travels opposite to the traced direction.
  vec3 flux=-direction*dot(fluence,vec4(1.0));
  outColor=air ? mix(previous,fluence,uCacheBlend) : previous;
  outHaze=vec4(air ? mix(previousFlux.xyz,flux,uCacheBlend) : previousFlux.xyz,mix(previousFlux.w,air ? 1.0 : 0.0,uCacheBlend));
}

// Light on the wall and endcaps for the raster preview, excluding direct
// sunlight (its analytic bake). A path from a uniform point in each atlas
// texel, in a cosine-distributed direction, estimates the irradiance there.
// Returns false outside the endcap discs.
bool startSurfacePath(out vec3 origin,out vec3 direction) {
  uvec2 texel=uvec2(gl_FragCoord.xy);
  vec2 size=vec2(textureSize(uPreviousSurface,0));
  startSample((texel.x+texel.y*uint(size.x))*9781u+0x1b873593u,uSurfaceSample);
  vec3 p;
  if (!surfaceAtlasPoint((vec2(texel)+vec2(randomValue(),randomValue()))/size,p)) return false;
  landObjects=false;pathLandObjects=false;
  vec3 normal=interiorNormal(p);
  origin=p+normal*(EPS*4.0);
  direction=around(normal,sqrt(randomValue()),2.0*PI*randomValue());
  return true;
}

void finishSurfacePath(vec4 radiance) {
  vec4 previous=texelFetch(uPreviousSurface,ivec2(gl_FragCoord.xy),0);
  // Luminance-weighted irradiance in each reflectance band, relative to
  // sunlight's. Cosine-distributed directions make irradiance π × radiance;
  // four uniform wavelengths each have density 1/400 nm. Weighting by
  // luminance makes the preview's luminance exact for any band reflectances.
  vec3 bands=vec3(spectralXYZ(radiance*materialSpectrum(vec3(1,0,0))).y,spectralXYZ(radiance*materialSpectrum(vec3(0,1,0))).y,
    spectralXYZ(radiance*materialSpectrum(vec3(0,0,1))).y)*(100.0*PI)/uSolarBands;
  if (any(isnan(bands)) || any(isinf(bands))) {outColor=previous;return;}
  outColor=vec4(previous.rgb+(bands-previous.rgb)/float(uSurfaceHistory+1),1.0);
}

vec3 cameraRay() {
  uvec2 pixel=uvec2(gl_FragCoord.xy);
  startSample((pixel.x+pixel.y*uint(uResolution.x))*9781u+0x68bc21ebu,uSample);
  vec2 jitter=uDiagnostic==0 ? vec2(randomValue(),randomValue())-0.5 : vec2(0.0);
  vec2 ndc=(gl_FragCoord.xy+jitter)/uResolution*2.0-1.0;
  vec4 view=uInverseProjection*vec4(ndc,1.0,1.0);
  return normalize((uCameraMatrix*vec4(normalize(view.xyz/view.w),0.0)).xyz);
}

vec3 diagnosticColor(vec3 ray) {
  float distance=traceInterior(uCameraPosition,ray);
  vec3 opticalDepth=vec3(0.0);
  float densityIntegral=0.0,liquidIntegral=0.0;
  vec3 airBeta=vec3(0.0),cloudBeta=vec3(0.0);
  if(uAtmosphere && uPressure>0.0) {
    wavelength=vec4(680.0,550.0,440.0,550.0);
    spectralBin=(wavelength-380.0)/10.0;prepareWavelength();
    airBeta=(sigmaRayleigh+aerosolExtinction).xyz;cloudBeta=cloudExtinction.xyz;
  }
  for (int i=0;i<128;i++) {
    if (i>=uSteps) break;
    vec3 p=uCameraPosition+ray*distance*(float(i)+0.5)/float(uSteps);
    float segment=distance/float(uSteps);
    opticalDepth+=(airBeta*airDensity(p)+cloudBeta*weatherAt(p).r)*segment;
    densityIntegral+=airDensity(p)*segment;
    liquidIntegral+=weatherAt(p).r*segment*1000.0;
  }
  if (uDiagnostic==2) return mix(vec3(0.02,0.08,0.18),vec3(0.98,0.7,0.19),1.0-exp(-densityIntegral/8.0));
  if (uDiagnostic==3) return mix(vec3(0.015,0.025,0.04),vec3(0.48,0.87,0.83),1.0-exp(-liquidIntegral*2.0));
  return exp(-opticalDepth);
}

void finishCameraSample(vec3 color,vec3 haze) {
  vec2 moments=vec2(color.y-haze.y,haze.y);
  moments*=moments;
  if (uHistory>0 && uDiagnostic==0) {
    vec4 previous=texelFetch(uPrevious,ivec2(gl_FragCoord.xy),0),previousHaze=texelFetch(uPreviousHaze,ivec2(gl_FragCoord.xy),0);
    float count=float(uHistory+1);
    color=previous.rgb+(color-previous.rgb)/count;
    haze=previousHaze.rgb+(haze-previousHaze.rgb)/count;
    moments=vec2(previous.a,previousHaze.a)+(moments-vec2(previous.a,previousHaze.a))/count;
  }
  outColor=vec4(color,moments.x);
  outHaze=vec4(haze,moments.y);
}

void main() {
  vec3 origin=uCameraPosition,direction;
  float density=1.0;
  int hero=0;
  bool air=true;
  if (uCachePass) {
    if (!startCachePath(origin,direction,density,hero,air)) return;
  } else if (uSurfacePass) {
    if (!startSurfacePath(origin,direction)) {outColor=vec4(0.0);return;}
  } else {
    direction=cameraRay();
    if (uDiagnostic!=0) {finishCameraSample(diagnosticColor(direction),vec3(0.0));return;}
  }
  // The only call of the tracer: a second inlined copy would double compile
  // time and slow software rasterizers by half.
  vec4 hazeRadiance=vec4(0.0);
  vec4 radiance=air ? pathRadiance(origin,direction,uDropletLimit,uCachePass || uSurfacePass,uSurfaceCache && !uCachePass && !uSurfacePass,hazeRadiance) : vec4(0.0);
  if (uCachePass) {finishCachePath(radiance,direction,density,hero,air);return;}
  if (uSurfacePass) {finishSurfacePath(radiance);return;}
  // Four wavelengths, each with density 1/400 nm, share one estimate.
  float scale=100.0*683.0/uReferenceIlluminance;
  vec3 color=spectralXYZ(radiance)*scale,haze=spectralXYZ(hazeRadiance)*scale;
  // A numerical failure in one sample must not poison the whole history.
  if (any(isnan(color)) || any(isinf(color))) {color=vec3(0.0);haze=vec3(0.0);}
  finishCameraSample(color,haze);
}
