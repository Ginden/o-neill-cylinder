uniform mat4 uInverseProjection;
uniform mat4 uCameraMatrix;
uniform vec3 uCameraPosition;
uniform vec2 uResolution;
uniform int uSteps;
uniform int uDiagnostic;
uniform float uExposure;
out vec4 outColor;

float hg(float mu, float g) {
  return (1.0-g*g) / (4.0*PI * pow(max(0.001,1.0+g*g-2.0*g*mu),1.5));
}

vec3 aces(vec3 x) {
  return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0);
}

void main() {
  vec2 ndc = gl_FragCoord.xy / uResolution * 2.0 - 1.0;
  vec4 view = uInverseProjection * vec4(ndc, 1.0, 1.0);
  vec3 ray = normalize((uCameraMatrix * vec4(normalize(view.xyz/view.w),0.0)).xyz);
  vec3 origin = uCameraPosition;
  float boundary = boundaryDistance(origin, ray);
  float distance = 0.0;
  // Ray march a conservative cylindrical terrain heightfield.
  for (int j = 0; j < 110; j++) {
    float sdf = surfaceDistance(origin + ray * distance);
    if (sdf < 0.0015 || distance >= boundary) break;
    distance += max(0.001, sdf * 0.55);
  }
  distance = min(distance, boundary);
  vec3 hit = origin + ray * distance;
  vec3 background = shadeSurface(hit, ray);
  vec3 transmittance = vec3(1.0);
  vec3 scattered = vec3(0.0);
  float densityIntegral = 0.0;
  float liquidIntegral = 0.0;
  float segment = distance / float(uSteps);
  float jitter = hash(gl_FragCoord.xy) * 0.6 + 0.2;
  for (int i = 0; i < 128; i++) {
    if (i >= uSteps) break;
    vec3 p = origin + ray * (float(i)+jitter) * segment;
    float density = airDensity(p);
    float cloud = uAtmosphere ? cloudExtinction(p) : 0.0;
    vec3 betaR = uAtmosphere ? vec3(0.005802,0.013558,0.0331) * density : vec3(0.0);
    float betaM = uAtmosphere ? uAerosol * density : 0.0;
    vec3 beta = betaR + vec3(betaM + cloud);
    vec3 source = vec3(0.0);
    for (int j = 0; j < 3; j++) {
      if (j >= uLightCount) break;
      float mu = dot(ray, uLights[j]);
      float rayleighPhase = 3.0 / (16.0*PI) * (1.0+mu*mu);
      vec3 light = sunlight(p, uLights[j]);
      source += light * (betaR*rayleighPhase + vec3(betaM*hg(mu,uAerosolG) + cloud*hg(mu,0.85)));
    }
    // Clearly approximate multiple scattering in clouds via low-order diffuse fill.
    source += cloud * vec3(0.018,0.022,0.027) * uSolarPower;
    vec3 attenuation = exp(-beta*segment);
    scattered += transmittance * source * (vec3(1.0)-attenuation) / max(beta,vec3(1e-7));
    transmittance *= attenuation;
    densityIntegral += density * segment;
    liquidIntegral += weatherAt(p).r * segment * 1000.0;
  }
  vec3 color = background*transmittance + scattered;
  if (uDiagnostic == 1) color = transmittance;
  if (uDiagnostic == 2) {
    float column = 1.0 - exp(-densityIntegral / 8.0);
    color = mix(vec3(0.02,0.08,0.18),vec3(0.98,0.7,0.19),column);
  }
  if (uDiagnostic == 3) {
    float column = 1.0-exp(-liquidIntegral*2.0);
    color = mix(vec3(0.015,0.025,0.04),vec3(0.48,0.87,0.83),column);
  }
  if (uDiagnostic == 0) color = aces(color*uExposure);
  // sRGB encoding, applied once after linear light integration and tone mapping.
  color = mix(color*12.92, 1.055*pow(max(color,vec3(0.0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),color));
  outColor = vec4(color,1.0);
}
