// Reflectance anchors are (680 nm, 550 nm, 440 nm). They are assumed materials
// in typical published ranges, not measured habitat spectra. Vegetation stays
// dark at 680 nm, where chlorophyll absorbs.
vec3 cropAlbedo(Field field, vec2 g) {
  float c = field.crop, v = field.id;
  float phase = v * 7.0;
  // Distance to the nearest tramline pair across the sowing direction.
  float tram = abs(fract(field.rows / 0.021 + phase) - 0.5) * 0.021;
  float tracks = 1.0 - smoothstep(0.0004, 0.0009, abs(tram - 0.0009));
  float bands = step(0.5, fract(field.rows / 0.012 + phase));
  vec3 color;
  if (c < 0.28) color = mix(vec3(0.042, 0.092, 0.03), vec3(0.07, 0.13, 0.045), v) * (0.94 + 0.12 * bands * step(0.5, v));
  else if (c < 0.48) color = mix(vec3(0.28, 0.22, 0.10), vec3(0.37, 0.29, 0.15), v) * (1.0 - 0.3 * tracks);
  else if (c < 0.58) color = mix(vec3(0.33, 0.29, 0.19), vec3(0.42, 0.37, 0.25), v)
    * (0.92 + 0.14 * (1.0 - smoothstep(0.0005, 0.0012, abs(fract(field.rows / 0.006 + phase) - 0.5) * 0.006)));
  else if (c < 0.70) color = mix(vec3(0.04, 0.105, 0.033), vec3(0.065, 0.15, 0.045), v) * (1.0 - 0.25 * tracks);
  else if (c < 0.80) color = mix(vec3(0.13, 0.09, 0.06), vec3(0.2, 0.14, 0.09), v)
    * (0.9 + 0.1 * noise(vec2(field.rows * 900.0, v * 50.0)));
  else if (c < 0.91) color = mix(vec3(0.1, 0.14, 0.055), vec3(0.17, 0.19, 0.08), v) * (0.9 + 0.2 * bands);
  else if (c < 0.97) color = mix(vec3(0.028, 0.07, 0.026), vec3(0.04, 0.09, 0.03), v) * (1.0 - 0.2 * tracks);
  else color = mix(vec3(0.38, 0.32, 0.05), vec3(0.45, 0.39, 0.07), v) * (1.0 - 0.3 * tracks);
  // Soil moisture and nutrient patches inside each field.
  float patches = noise(g * 22.0 + v * 40.0) * 0.6 + noise(g * 70.0 - v * 40.0) * 0.4;
  return color * (0.84 + 0.32 * patches);
}

vec3 groundAlbedo(vec3 p, vec3 n) {
  vec2 g = groundCoordinates(p);
  float river = riverEdge(g);
  vec4 cover = coverAt(g);
  Field field = fieldAt(g);
  vec3 grass = vec3(0.045, 0.1, 0.034) * (0.85 + 0.3 * noise(g * 160.0));
  vec3 color = cropAlbedo(field, g);
  // Grass margins, hedge bottoms and farm tracks with a grassy center strip.
  color = mix(color, grass, 1.0 - smoothstep(0.0015, 0.0035, field.edge));
  color = mix(color, vec3(0.03, 0.055, 0.025), 1.0 - smoothstep(0.002, 0.004, field.hedge));
  float track = 1.0 - smoothstep(0.0012, 0.0018, field.track);
  vec3 gravel = vec3(0.22, 0.2, 0.16) * (0.85 + 0.3 * noise(g * 400.0));
  color = mix(color, mix(gravel, grass, 1.0 - smoothstep(0.0002, 0.0004, field.track)), track);
  // Villages: lawns, gardens and paved yards.
  float village = villageDensity(g);
  float yard = smoothstep(0.45, 0.6, noise(g * 90.0 + 3.0));
  vec3 settlement = mix(mix(grass * 1.15, vec3(0.06, 0.09, 0.035), noise(g * 50.0)), vec3(0.24, 0.23, 0.21), yard * 0.6);
  color = mix(color, settlement, smoothstep(0.08, 0.25, village));
  // Shaded litter and understory beneath woodland canopy.
  color = mix(color, vec3(0.04, 0.05, 0.03) * (0.8 + 0.4 * noise(g * 200.0)), smoothstep(0.3, 0.7, cover.r) * step(0.95, cover.g));
  // Valley road with gravel shoulders.
  float road = roadDistance(g);
  vec3 asphalt = vec3(0.075, 0.075, 0.072) * (0.92 + 0.16 * noise(g * 300.0));
  color = mix(color, vec3(0.2, 0.19, 0.16), 1.0 - smoothstep(ROAD_HALF_WIDTH + 0.001, ROAD_HALF_WIDTH + 0.002, road));
  color = mix(color, asphalt, 1.0 - smoothstep(ROAD_HALF_WIDTH - 0.0003, ROAD_HALF_WIDTH, road));
  // Riverbank gravel and mud, then the water surface.
  float bank = river + 0.0015 * (noise(g * 300.0) - 0.5);
  color = mix(color, vec3(0.06, 0.12, 0.045), 1.0 - smoothstep(0.004, 0.009, bank));
  color = mix(color, vec3(0.16, 0.14, 0.11), 1.0 - smoothstep(0.0015, 0.0035, bank));
  // Exposed terrace faces are bare soil and rock.
  float radialSlope = 1.0 - abs(dot(n.xy, normalize(p.xy)));
  color = mix(color, vec3(0.24, 0.22, 0.18), smoothstep(0.25, 0.5, radialSlope));
  return mix(color, vec3(0.025, 0.055, 0.045), 1.0 - smoothstep(-0.0005, 0.0, river));
}

vec3 objectAlbedo(vec3 p, float kind, vec2 id) {
  vec2 g = groundCoordinates(p);
  if (kind < 1.5) {
    // Per-tree species and vigor; leaf clumps darken interior gaps.
    float species = hash(id + 43.0);
    vec3 leaves = species > 0.8 ? vec3(0.022, 0.05, 0.021) : mix(vec3(0.03, 0.075, 0.026), vec3(0.055, 0.115, 0.035), hash(id + 101.0));
    return leaves * (0.7 + 0.6 * noise(g * 900.0 + id));
  }
  if (kind < 2.5) return mix(vec3(0.55, 0.52, 0.45), vec3(0.66, 0.62, 0.55), hash(id + 107.0));
  float roof = hash(id + 109.0);
  vec3 tiles = roof < 0.55 ? vec3(0.3, 0.12, 0.065) : roof < 0.8 ? vec3(0.14, 0.095, 0.075) : vec3(0.085, 0.085, 0.09);
  return tiles * (0.85 + 0.3 * hash(id + 113.0));
}

// Geometric normal from a tetrahedral stencil of the distance field. Small
// objects need a short stencil; terrain uses 2 m, below the atlas texel but
// above float cancellation.
vec3 landNormal(vec3 p, float kind) {
  float e = kind > 0.5 ? 0.0002 : 0.002;
  vec3 gradient = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec3 k = i == 0 ? vec3(1,-1,-1) : i == 1 ? vec3(-1,-1,1) : i == 2 ? vec3(-1,1,-1) : vec3(1);
    float above, objectKind;
    vec2 id;
    float d = baseDistance(p + e * k, above);
    if (kind > 0.5) d = min(d, objectDistance(p + e * k, above, objectKind, id));
    gradient += k * d;
  }
  // A conservative object bound can be locally constant.
  return dot(gradient, gradient) > 1e-16 ? normalize(gradient) : -normalize(vec3(p.xy, 0.0));
}
vec3 surfaceNormal(vec3 p) {
  vec2 id;
  return landNormal(p, landKind(p, id));
}

// Smooth terrain shading normal: central differences of the bilinear atlas over
// one texel give continuous slopes instead of per-texel facets.
vec3 terrainShadingNormal(vec3 p) {
  vec2 slope;
  vec2 g = groundCoordinates(p);
  if (uCachedTerrain) {
    vec2 texel = 1.0 / vec2(textureSize(uTerrain, 0));
    vec2 uv = atlasCoordinates(p);
    slope = vec2(
      textureLod(uTerrain, uv + vec2(texel.x, 0), 0.0).r - textureLod(uTerrain, uv - vec2(texel.x, 0), 0.0).r,
      textureLod(uTerrain, uv + vec2(0, texel.y), 0.0).r - textureLod(uTerrain, uv - vec2(0, texel.y), 0.0).r)
      / (2.0 * texel * vec2(2.0 * PI * uRadius, uLength));
  } else {
    float e = 0.003;
    slope = vec2(groundHeight(g + vec2(e, 0)) - groundHeight(g - vec2(e, 0)),
      groundHeight(g + vec2(0, e)) - groundHeight(g - vec2(0, e))) / (2.0 * e);
  }
  // Metre-scale relief: furrows, tussocks and ruts.
  slope += 0.06 * (vec2(noise(g * 600.0), noise(g * 600.0 + 17.0)) - 0.5);
  vec3 up = -normalize(vec3(p.xy, 0.0));
  vec3 tangent = vec3(up.y, -up.x, 0.0);
  return normalize(up - slope.x * tangent - slope.y * vec3(0, 0, 1));
}
