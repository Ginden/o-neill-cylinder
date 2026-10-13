uniform float uReferenceIlluminance;
uniform float uLampScale;

vec4 blackbody(float temperature) {
  vec4 lambda=wavelength*1e-9;
  return 1.191042972e-16/(pow(lambda,vec4(5.0))*(exp(0.01438776877/(lambda*temperature))-1.0))*1e-9;
}
vec4 solarRadiance() {return solarSpectrum;}
vec4 solarIrradiance() {return solarRadiance()*SUN_SOLID_ANGLE;}
vec4 lampRadiance() {return lampSpectrum;}

vec4 matchingGaussian(float center,float left,float right) {
  vec4 t=(wavelength-center)*mix(vec4(right),vec4(left),lessThan(wavelength,vec4(center)));
  return exp(-0.5*t*t);
}
// CIE XYZ of spectral radiance sampled at the four path wavelengths.
vec3 spectralXYZ(vec4 radiance) {
  vec4 x=0.362*matchingGaussian(442.0,0.0624,0.0374)+1.056*matchingGaussian(599.8,0.0264,0.0323)-0.065*matchingGaussian(501.1,0.049,0.0382);
  vec4 y=0.821*matchingGaussian(568.8,0.0213,0.0247)+0.286*matchingGaussian(530.9,0.0613,0.0322);
  vec4 z=1.217*matchingGaussian(437.0,0.0845,0.0278)+0.681*matchingGaussian(459.0,0.0385,0.0725);
  return vec3(dot(x,radiance),dot(y,radiance),dot(z,radiance));
}

// Explicit bounded reflectance curves through 440 / 550 / 680 nm anchors.
// These are assumed materials, not measured spectra inferred from photographs.
vec4 materialSpectrum(vec3 anchors) {
  vec4 blue=mix(vec4(anchors.b),vec4(anchors.g),clamp((wavelength-440.0)/110.0,0.0,1.0));
  vec4 red=mix(vec4(anchors.g),vec4(anchors.r),clamp((wavelength-550.0)/130.0,0.0,1.0));
  return mix(red,blue,lessThan(wavelength,vec4(550.0)));
}
