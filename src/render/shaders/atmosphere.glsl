uniform mat4 uInverseProjection;
uniform mat4 uCameraMatrix;
uniform vec3 uCameraPosition;
uniform vec2 uResolution;
uniform int uSteps;
uniform int uDiagnostic;
uniform sampler2D uPrevious;
out vec4 outColor;

void main() {
  uvec2 pixel=uvec2(gl_FragCoord.xy);
  rngState=(pixel.x+pixel.y*uint(uResolution.x))*9781u+0x68bc21ebu;
  int offset=int(randomValue()*41.0);
  rngState+=uint(uSample)*6271u;
  // Each pixel covers all wavelength strata every 41 samples. A stable random
  // offset and coprime permutation preserve the uniform spectral estimator.
  int stratum=(uSample%41*17+offset)%41;
  wavelength=380.0+(float(stratum)+randomValue())*(400.0/41.0);
  spectralBin=(wavelength-380.0)/10.0;
  vec2 jitter=uDiagnostic==0 ? vec2(randomValue(),randomValue())-0.5 : vec2(0.0);
  vec2 ndc=(gl_FragCoord.xy+jitter)/uResolution*2.0-1.0;
  vec4 view=uInverseProjection*vec4(ndc,1.0,1.0);
  vec3 ray=normalize((uCameraMatrix*vec4(normalize(view.xyz/view.w),0.0)).xyz);
  vec3 color;
  if (uDiagnostic==0) color=matchingXYZ()*pathRadiance(uCameraPosition,ray)*(400.0*683.0/uReferenceIlluminance);
  else {
    float distance=traceInterior(uCameraPosition,ray);
    vec3 opticalDepth=vec3(0.0);
    float densityIntegral=0.0,liquidIntegral=0.0;
    for (int i=0;i<128;i++) {
      if (i>=uSteps) break;
      vec3 p=uCameraPosition+ray*distance*(float(i)+0.5)/float(uSteps);
      float segment=distance/float(uSteps);
      wavelength=680.0;spectralBin=30.0;opticalDepth.r+=extinctionAt(p)*segment;
      wavelength=550.0;spectralBin=17.0;opticalDepth.g+=extinctionAt(p)*segment;
      wavelength=440.0;spectralBin=6.0;opticalDepth.b+=extinctionAt(p)*segment;
      densityIntegral+=airDensity(p)*segment;
      liquidIntegral+=weatherAt(p).r*segment*1000.0;
    }
    color=exp(-opticalDepth);
    if (uDiagnostic==2) color=mix(vec3(0.02,0.08,0.18),vec3(0.98,0.7,0.19),1.0-exp(-densityIntegral/8.0));
    if (uDiagnostic==3) color=mix(vec3(0.015,0.025,0.04),vec3(0.48,0.87,0.83),1.0-exp(-liquidIntegral*2.0));
  }
  if (uSample>0 && uDiagnostic==0) {
    vec3 previous=texelFetch(uPrevious,ivec2(gl_FragCoord.xy),0).rgb;
    color=previous+(color-previous)/float(uSample+1);
  }
  outColor=vec4(color,1.0);
}
