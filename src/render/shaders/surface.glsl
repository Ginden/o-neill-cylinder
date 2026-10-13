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
