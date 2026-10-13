uniform float uReferenceIlluminance;
uniform float uLampScale;

float blackbody(float temperature) {
  float lambda=wavelength*1e-9;
  return 1.191042972e-16/(pow(lambda,5.0)*(exp(0.01438776877/(lambda*temperature))-1.0))*1e-9;
}
float solarRadiance() {return blackbody(5772.0)*uSolarPower;}
float solarIrradiance() {return solarRadiance()*SUN_SOLID_ANGLE;}
float lampRadiance() {return blackbody(2800.0)*uLampScale;}

float matchingGaussian(float center,float left,float right) {
  float t=(wavelength-center)*(wavelength<center ? left : right);
  return exp(-0.5*t*t);
}
vec3 matchingXYZ() {
  return vec3(
    0.362*matchingGaussian(442.0,0.0624,0.0374)+1.056*matchingGaussian(599.8,0.0264,0.0323)-0.065*matchingGaussian(501.1,0.049,0.0382),
    0.821*matchingGaussian(568.8,0.0213,0.0247)+0.286*matchingGaussian(530.9,0.0613,0.0322),
    1.217*matchingGaussian(437.0,0.0845,0.0278)+0.681*matchingGaussian(459.0,0.0385,0.0725));
}

// Explicit bounded reflectance curves through 440 / 550 / 680 nm anchors.
// These are assumed materials, not measured spectra inferred from photographs.
float materialSpectrum(vec3 anchors) {
  if (wavelength<550.0) return mix(anchors.b,anchors.g,clamp((wavelength-440.0)/110.0,0.0,1.0));
  return mix(anchors.g,anchors.r,clamp((wavelength-550.0)/130.0,0.0,1.0));
}
