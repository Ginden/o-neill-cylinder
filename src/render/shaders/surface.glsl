vec3 stars(vec3 d) {
  vec2 uv = vec2(atan(d.y, d.x) / (2.0*PI), asin(d.z) / PI);
  vec2 grid = uv * vec2(1900.0, 950.0);
  vec2 cell = floor(grid);
  float star = step(0.9983, hash(cell)) * exp(-dot(fract(grid) - 0.5, fract(grid) - 0.5) * 120.0);
  // Fixed relative star radiance, independent of exposure and habitat sunlight.
  return vec3(0.00000001, 0.000000012, 0.000000015) + star * vec3(0.000012, 0.000014, 0.000018);
}

vec3 groundAlbedo(vec3 p, vec3 n) {
  vec2 uv = groundCoordinates(p);
  float river = 1.0 - smoothstep(0.035, 0.06, riverDistance(uv));
  vec2 plots = uv * vec2(5.0, 4.0);
  float plot = hash(floor(plots));
  vec3 field = mix(vec3(0.19, 0.30, 0.085), vec3(0.55, 0.43, 0.14), smoothstep(0.35, 0.9, plot));
  float forests = smoothstep(0.48, 0.68, fbm(uv * 2.6 + 70.0));
  field = mix(field, vec3(0.045, 0.16, 0.065), forests);
  float edge = min(min(fract(plots.x), 1.0-fract(plots.x)), min(fract(plots.y), 1.0-fract(plots.y)));
  field *= 0.8 + 0.2 * smoothstep(0.01, 0.045, edge);
  // Small settlements along the river; roofs, roads and planted field boundaries.
  float village = step(0.66, noise(uv * 1.4 + 113.0)) * (1.0-smoothstep(0.18, 0.45, riverDistance(uv)));
  vec2 blocks = fract(uv * 55.0);
  float roof = step(0.2, blocks.x) * step(blocks.x, 0.75) * step(0.2, blocks.y) * step(blocks.y, 0.75);
  field = mix(field, mix(vec3(0.26, 0.26, 0.22), vec3(0.43, 0.18, 0.085), roof), village);
  vec3 water = vec3(0.025, 0.105, 0.13);
  float radialSlope = 1.0 - abs(dot(n.xy, normalize(p.xy)));
  field = mix(field, vec3(0.25, 0.23, 0.19), smoothstep(0.08, 0.3, radialSlope));
  return mix(field, water, river);
}

vec3 surfaceNormal(vec3 p) {
  float e = 0.002;
  return normalize(vec3(
    surfaceDistance(p + vec3(e,0,0)) - surfaceDistance(p - vec3(e,0,0)),
    surfaceDistance(p + vec3(0,e,0)) - surfaceDistance(p - vec3(0,e,0)),
    surfaceDistance(p + vec3(0,0,e)) - surfaceDistance(p - vec3(0,0,e))));
}

vec3 shadeSurface(vec3 p, vec3 ray) {
  float theta = atan(p.y, p.x);
  bool cap = abs(p.z) >= uLength * 0.5 - 0.004;
  bool window = windowAt(theta) && !cap;
  float ring = 1.0 - smoothstep(0.008, 0.025, abs(fract((p.z + uLength*0.5) / 1.5 + 0.5) - 0.5) * 1.5);
  float phase = abs(fract((theta+PI*0.5)/(2.0*PI/3.0)+0.5)-0.5);
  float edge = 1.0 - smoothstep(0.003, 0.008, abs(phase - (1.0-uWindowFraction)*0.5));
  float frame = max(ring, edge);
  if (window && frame < 0.01) return stars(ray) * uWindowTransmission;
  vec3 n = window || cap ? (cap ? vec3(0,0,-sign(p.z)) : -normalize(vec3(p.xy,0))) : surfaceNormal(p);
  vec3 albedo = cap ? vec3(0.23,0.28,0.3) : window ? vec3(0.38,0.43,0.46) : groundAlbedo(p, n);
  if (!window && !cap) albedo = mix(albedo, vec3(0.3,0.35,0.36), ring * 0.35);
  vec3 radiance = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    if (i >= uLightCount) break;
    // Offset into the air so a floor point's exit root is not the same wall.
    vec3 light = sunlight(p + n * 0.005, uLights[i]);
    radiance += albedo / PI * light * max(0.0, dot(n, uLights[i]));
  }
  // Explicit low-order diffuse bounce approximation; no ambient light in vacuum/night.
  float bounce = uAtmosphere ? min(0.06, uPressure / 1013.25 * 0.04) : 0.0;
  radiance += albedo * vec3(0.6,0.75,1.0) * bounce * uSolarPower;
  // Small settlement lights become visible at night without brightening the whole floor.
  if (!window && !cap && uSolarPower < 0.02) {
    vec2 uv = groundCoordinates(p);
    float city = step(0.66, noise(uv*1.4+113.0)) * (1.0-smoothstep(0.18,0.45,riverDistance(uv)));
    float lamp = step(0.94, hash(floor(uv*80.0)));
    radiance += city * lamp * vec3(0.035,0.018,0.005);
  }
  return window ? mix(stars(ray)*uWindowTransmission, radiance, frame) : radiance;
}
