const float PI = 3.141592653589793;
float wavelength;
float spectralBin;
float glassIndex;
float sigmaRayleigh;
vec2 sigmaAerosol;
vec2 sigmaCloud;
float solarSpectrum;
float lampSpectrum;
uniform float uRadius;
uniform float uLength;
uniform float uGravity;
uniform float uPressure;
uniform float uTemperature;
uniform float uLapse;
uniform float uWindowFraction;
uniform float uWindowTransmission;
uniform float uTerrainHeight;
uniform sampler2D uTerrain;
uniform bool uCachedTerrain;
uniform float uAerosol;
uniform float uAerosolScale;
uniform sampler2D uAerosolPhase;
uniform sampler2D uCloudPhase;
uniform float uSolarPower;
uniform vec3 uSun;
uniform vec3 uMirrorCenter[3];
uniform vec3 uMirrorNormal[3];
uniform vec3 uMirrorAcross[3];
uniform vec3 uMirrorAlong[3];
uniform vec2 uMirrorSize;
uniform int uMirrorCount;
uniform float uMirrorReflectivity;
uniform float uAirMajorant;
uniform highp sampler3D uCloudMajorant;
uniform bool uAtmosphere;
uniform bool uClouds;
uniform highp sampler3D uWeather;

bool windowAt(float theta) {
  float phase = (theta + PI * 0.5) / (2.0 * PI / 3.0);
  return abs(fract(phase + 0.5) - 0.5) > (1.0 - uWindowFraction) * 0.5;
}

float boundaryDistance(vec3 p, vec3 d) {
  float a = dot(d.xy, d.xy);
  float b = dot(p.xy, d.xy);
  float c = dot(p.xy, p.xy) - uRadius * uRadius;
  float side = a < 1e-8 ? 1e8 : (-b + sqrt(max(0.0, b*b - a*c))) / a;
  float cap = abs(d.z) < 1e-8 ? 1e8 : (sign(d.z) * uLength * 0.5 - p.z) / d.z;
  return min(side, cap);
}

float airDensity(vec3 p) {
  float h = (uRadius * uRadius - dot(p.xy, p.xy)) / (2.0 * uRadius);
  float t = uTemperature - uLapse * h;
  float pressureRatio = uLapse < 1e-5
    ? exp(-uGravity * 9.80665 * h * 1000.0 / (287.05 * uTemperature))
    : pow(t / uTemperature, uGravity * 9.80665 * 1000.0 / (287.05 * uLapse));
  return uPressure / 1013.25 * pressureRatio * 288.15 / t;
}

vec4 weatherAt(vec3 p) {
  if (!uClouds || uPressure <= 0.0) return vec4(0.0);
  vec3 uv = vec3(p.xy / (2.0 * uRadius) + 0.5, p.z / uLength + 0.5);
  return texture(uWeather, uv);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
    mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}

float fbm(vec2 p) {
  float result = 0.0, weight = 0.5;
  for (int j = 0; j < 4; j++) {
    result += weight * noise(p);
    p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.03 + 8.2;
    weight *= 0.5;
  }
  return result;
}

vec2 groundCoordinates(vec3 p) {
  return vec2(atan(p.y, p.x) * uRadius, p.z);
}

float riverDistance(vec2 p) {
  float meander = 0.22 * sin(p.y * 0.8) + 0.12 * sin(p.y * 1.7);
  float sector = 2.0 * PI * uRadius / 3.0;
  float center = (floor((p.x + PI*uRadius*0.5) / sector + 0.5) * sector - PI*uRadius*0.5);
  return abs(p.x - center - meander);
}

float groundHeight(vec2 p) {
  float hills = fbm(p * vec2(1.5, 0.65) + 21.0);
  float valley = smoothstep(0.06, 0.75, riverDistance(p));
  return uTerrainHeight * (0.04 + hills * hills * 1.8 * valley);
}

float surfaceDistance(vec3 p) {
  float theta = atan(p.y, p.x);
  float height = uCachedTerrain
    ? texture(uTerrain,vec2((theta+PI)/(2.0*PI),p.z/uLength+0.5)).r
    : groundHeight(groundCoordinates(p));
  float radius=length(p.xy);
  float phase=(theta+PI*0.5)/(2.0*PI/3.0);
  float margin=((1.0-uWindowFraction)*0.5-abs(fract(phase+0.5)-0.5))*(2.0*PI/3.0);
  // Terrain is a solid clipped to each land sector, including its exposed
  // terrace sides. Switching heights abruptly at the edge was not a distance
  // field: it invented radial normals on these angular faces.
  float landDistance=radius*sin(margin);
  float terrainDistance=max(uRadius-radius-height,-landDistance);
  return min(min(uRadius-radius,terrainDistance),uLength*0.5-abs(p.z));
}
