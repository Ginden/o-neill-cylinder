// Scattered-light cache: fluence of light that has scattered at least once, on
// a cylindrical grid. Unscattered sunlight is excluded; next-event estimation
// supplies it exactly. Radial bins are uniform in sqrt(depth below the wall),
// finest along the ground and windows (about 8 m) and coarsest at the axis.
// Each cell stores the fluence at four node wavelengths divided by the 5772 K
// Planck spectrum, the flux of their sum, and the fraction of its volume in air.
const int CACHE_RADIAL=32;
const int CACHE_ANGULAR=96;
const int CACHE_AXIAL=64;
const vec4 CACHE_WAVELENGTHS=vec4(400.0,500.0,600.0,700.0);
uniform sampler2D uCacheFluence;
uniform sampler2D uCacheFlux;
// Diffusion coefficient at the node wavelengths; positive in deep cells, where
// the diffusion equation replaces transport (cache-diffusion.glsl).
uniform sampler2D uCacheDiffusion;
uniform float uCloudAsymmetry;

ivec2 cacheTexel(ivec3 cell) {return ivec2(cell.y,cell.x+cell.z*CACHE_RADIAL);}

// Continuous cell coordinates: radial, angular, axial.
vec3 cacheCoordinates(vec3 p) {
  float depth=clamp(1.0-length(p.xy)/uRadius,0.0,1.0);
  float angle=fract(atan(p.y,p.x)/(2.0*PI)+1.0);
  return vec3(sqrt(depth)*float(CACHE_RADIAL),angle*float(CACHE_ANGULAR),(p.z/uLength+0.5)*float(CACHE_AXIAL));
}

bool cacheDeep(vec3 p) {
  ivec3 cell=clamp(ivec3(cacheCoordinates(p)),ivec3(0),ivec3(CACHE_RADIAL,CACHE_ANGULAR,CACHE_AXIAL)-1);
  return texelFetch(uCacheDiffusion,cacheTexel(cell),0).x>0.0;
}

// Scattered radiance leaving p in direction `outgoing` at the path wavelengths,
// from the cached fluence and flux (a P1 field) after scattering with mean
// cosine `asymmetry`. Interpolation weights include each cell's air fraction,
// so cells cut by terrain do not darken the air above it.
vec4 cachedRadiance(vec3 p,vec3 outgoing,float asymmetry) {
  vec3 c=cacheCoordinates(p)-0.5;
  ivec3 base=ivec3(floor(c));
  vec3 f=c-vec3(base);
  vec4 fluence=vec4(0.0);
  vec3 flux=vec3(0.0);
  float weight=0.0;
  for (int k=0;k<8;k++) {
    ivec3 corner=ivec3(k&1,(k>>1)&1,k>>2);
    ivec3 cell=base+corner;
    cell.x=clamp(cell.x,0,CACHE_RADIAL-1);
    cell.y=(cell.y+CACHE_ANGULAR)%CACHE_ANGULAR;
    cell.z=clamp(cell.z,0,CACHE_AXIAL-1);
    vec3 axes=mix(1.0-f,f,vec3(corner));
    vec4 stored=texelFetch(uCacheFlux,cacheTexel(cell),0);
    float w=axes.x*axes.y*axes.z*stored.w;
    fluence+=w*texelFetch(uCacheFluence,cacheTexel(cell),0);
    flux+=w*stored.xyz;
    weight+=w;
  }
  if (weight<=0.0) return vec4(0.0);
  fluence/=weight;flux/=weight;
  float total=dot(fluence,vec4(1.0));
  // Limit the flux so that the P1 radiance stays non-negative in every
  // direction. Clamping negative radiance instead would add energy at each
  // lookup, and the cache's feedback compounds any gain.
  float strength=3.0*asymmetry*length(flux);
  float anisotropy=strength>0.0 ? min(1.0,strength/max(total,1e-30))*dot(normalize(flux),outgoing) : 0.0;
  // Piecewise-linear between nodes; constant beyond 400 and 700 nm.
  vec4 transfer;
  for (int k=0;k<4;k++) {
    float x=clamp((wavelength[k]-CACHE_WAVELENGTHS.x)/100.0,0.0,3.0);
    int i=min(2,int(x));
    transfer[k]=mix(fluence[i],fluence[i+1],x-float(i));
  }
  return (1.0+anisotropy)*transfer*blackbody(5772.0)/(4.0*PI);
}
