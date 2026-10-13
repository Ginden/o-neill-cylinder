const float PI = 3.141592653589793;
const float SECTOR_ANGLE = 2.0943951023931953;
// Hero wavelength sampling: each path carries four wavelengths. Component x is
// the hero, whose densities make sampling decisions; y, z and w are rotated by
// 100, 200 and 300 nm. Every spectral quantity below is per component.
vec4 wavelength;
vec4 spectralBin;
vec4 glassIndex;
vec4 sigmaRayleigh;
vec4 aerosolExtinction;
vec4 aerosolScattering;
vec4 cloudExtinction;
vec4 cloudScattering;
vec4 solarSpectrum;
vec4 lampSpectrum;
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
// Half-resolution, half-precision terrain: cheap to filter, used to stand objects.
uniform sampler2D uAnchorTerrain;
uniform bool uCachedTerrain;
uniform sampler2D uLandCover;
uniform bool uLandUse;
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
  float phase = (theta + PI * 0.5) / SECTOR_ANGLE;
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

// Integer lattice hash (PCG2D). Sine hashes lose precision at kilometre-scale
// coordinates multiplied by metre-scale frequencies.
uvec2 latticeHash(vec2 p) {
  uvec2 v = uvec2(ivec2(floor(p)) + 1073741824) * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  return v;
}
float hash(vec2 p) {return float(latticeHash(p).x >> 8u) / 16777216.0;}
// Eight independent byte-resolution values from one lattice hash.
void hash8(vec2 p, out vec4 a, out vec4 b) {
  uvec2 v = latticeHash(p);
  a = vec4(v.x & 255u, (v.x >> 8u) & 255u, (v.x >> 16u) & 255u, v.x >> 24u) / 256.0;
  b = vec4(v.y & 255u, (v.y >> 8u) & 255u, (v.y >> 16u) & 255u, v.y >> 24u) / 256.0;
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

// Value noise with its analytic gradient, for slope-dependent erosion detail.
vec3 noiseGradient(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float a = hash(i), b = hash(i + vec2(1,0)), c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
  return vec3(a + (b-a)*u.x + (c-a)*u.y + (a-b-c+d)*u.x*u.y,
    du * (vec2(b-a, c-a) + (a-b-c+d) * u.yx));
}

// Slopes suppress finer octaves, leaving smooth valleys and sharper crests.
float erodedFbm(vec2 p) {
  float result = 0.0, weight = 0.5;
  vec2 slope = vec2(0.0);
  for (int j = 0; j < 7; j++) {
    vec3 n = noiseGradient(p);
    slope += n.yz;
    result += weight * n.x / (1.0 + dot(slope, slope));
    p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.0 + 3.7;
    weight *= 0.5;
  }
  return result;
}

// Arc length is measured from the +Y window center, so the coordinate seam lies
// inside a window and every land strip is continuous.
float groundAngle(vec3 p) {return mod(atan(p.y, p.x) - PI * 0.5, 2.0 * PI);}
vec2 groundCoordinates(vec3 p) {return vec2(groundAngle(p) * uRadius, p.z);}
vec2 atlasCoordinates(vec3 p) {return vec2(groundAngle(p) / (2.0 * PI), p.z / uLength + 0.5);}
float stripIndex(vec2 g) {return floor(g.x / (SECTOR_ANGLE * uRadius));}
// Signed distance across the strip from its center line, in kilometres.
float stripOffset(vec2 g) {return g.x - (stripIndex(g) + 0.5) * SECTOR_ANGLE * uRadius;}
float landHalfWidth() {return (1.0 - uWindowFraction) * SECTOR_ANGLE * uRadius * 0.5;}

// Each valley has its own meander; amplitudes shrink with narrow land strips.
float riverCenter(float z, float strip) {
  float amplitude = clamp(landHalfWidth() / 2.2, 0.15, 1.0);
  return amplitude * (0.22 * sin(z * 0.8 + strip * 2.1) + 0.12 * sin(z * 1.7 + strip * 4.3) + 0.035 * sin(z * 4.3 + strip));
}
float riverHalfWidth(float z, float strip) {return 0.031 + 0.008 * sin(z * 0.53 + strip * 1.3);}
float riverDistance(vec2 p) {return abs(stripOffset(p) - riverCenter(p.y, stripIndex(p)));}
float riverEdge(vec2 p) {return riverDistance(p) - riverHalfWidth(p.y, stripIndex(p));}

float groundHeight(vec2 p) {
  float strip = stripIndex(p);
  float across = abs(stripOffset(p)) / landHalfWidth();
  vec2 q = p + vec2(strip * 37.0, strip * 11.0);
  vec2 warp = vec2(fbm(q * 0.4 + 3.1), fbm(q * 0.4 + 9.7)) - 0.5;
  float hills = erodedFbm(q * vec2(1.25, 0.6) + warp * 1.6 + 21.0);
  float rise = smoothstep(0.1, 1.0, across);
  // A flat floodplain along the river; rolling eroded hills rise toward the
  // window-side ridges. The bound stays below 1.84 × relief.
  float floodplain = smoothstep(0.04, 0.42, max(0.0, riverEdge(p)));
  float relief = 0.1 + 0.45 * rise * rise + 0.95 * hills * hills * (0.4 + 0.6 * rise);
  return uTerrainHeight * (0.03 + floodplain * min(relief, 1.75));
}
