// Procedural land use in ground coordinates (arc length at the wall, axial z),
// in kilometres. Trees and houses are explicit upright geometry standing on the
// terrain at their own centers; the baked land-cover atlas decides where.
// CANOPY_TOP bounds them above the local terrain: crowns reach 29 m above their
// base, which can sit 8 m above terrain within their 5.5 m radius on 1.5 slopes.
const float CANOPY_TOP = 0.04;
const float TREE_CELL = 0.008;
const float HOUSE_CELL = 0.03;
const float ROAD_HALF_WIDTH = 0.0035;

vec2 groundAtlas(vec2 g) {return vec2(g.x / (2.0 * PI * uRadius), g.y / uLength + 0.5);}
// Atlas texels are fetched at the base level: random ray directions have no
// meaningful screen-space derivatives for automatic mip selection.
vec4 coverAt(vec2 g) {return textureLod(uLandCover, groundAtlas(g), 0.0);}

// The valley road follows one bank of the river at a varying distance.
float roadOffset(float z, float strip) {
  float side = mod(strip, 2.0) < 0.5 ? 1.0 : -1.0;
  float amplitude = clamp(landHalfWidth() / 2.2, 0.15, 1.0);
  return riverCenter(z, strip) + side * amplitude * (0.2 + 0.07 * sin(z * 0.37 + strip * 1.9));
}
float roadDistance(vec2 g) {return abs(stripOffset(g) - roadOffset(g.y, stripIndex(g)));}

struct Field {
  float edge;   // distance to the nearest field boundary
  float hedge;  // distance to a hedged parcel boundary
  float track;  // distance to a farm track
  float id;     // per-field random value
  float crop;   // per-field crop selector
  float rows;   // coordinate across the sowing direction
};

// Staggered rows of warped parcels, each split into one to three strip fields.
Field fieldAt(vec2 g) {
  float strip = stripIndex(g);
  vec2 warp = vec2(noise(g * 0.7 + 13.0 + strip), noise(g * 0.7 + 47.0 - strip)) - 0.5;
  vec2 frequency = vec2(3.3, 2.5);
  vec2 plots = (g + warp * 0.16) * frequency;
  float row = floor(plots.y);
  plots.x += hash(vec2(row, 19.0 + strip)) * 0.85;
  vec2 cell = floor(plots), f = fract(plots);
  vec2 edge = min(f, 1.0 - f) / frequency;
  float edgeX = f.x < 0.5 ? cell.x : cell.x + 1.0;
  float edgeY = f.y < 0.5 ? row : row + 1.0;
  bool hedgeX = hash(vec2(edgeX, row) + vec2(71.0, 13.0 * strip)) < 0.5;
  // Row boundaries are shared by staggered parcels; hedges run in 400 m sections.
  bool hedgeY = hash(vec2(floor(g.x * 2.5), edgeY) + vec2(5.0, 91.0 + strip)) < 0.4;
  bool trackY = hash(vec2(floor(g.x * 1.5), edgeY) + vec2(17.0, 3.0 + strip)) < 0.3;
  Field field;
  field.hedge = min(hedgeX ? edge.x : 1.0, hedgeY ? edge.y : 1.0);
  field.track = trackY && !hedgeY ? edge.y : 1.0;
  bool alongU = hash(cell + vec2(9.0, strip)) < 0.55;
  float parts = floor(hash(cell + vec2(3.0, strip)) * 3.0) + 1.0;
  float split = (alongU ? f.y : f.x) * parts;
  float inner = min(fract(split), 1.0 - fract(split)) / parts / (alongU ? frequency.y : frequency.x);
  field.edge = min(min(edge.x, edge.y), inner);
  vec2 id = cell * 3.0 + vec2(floor(split), strip * 7.0);
  field.id = hash(id + 29.0);
  field.crop = hash(id + 31.0);
  field.rows = alongU ? g.y : g.x;
  return field;
}

// Villages straddle the valley road every few kilometres.
float villageDensity(vec2 g) {
  float strip = stripIndex(g);
  float along = noise(vec2(g.y * 0.6 + strip * 5.3, strip * 17.0 + 5.0));
  float spread = 0.07 + 0.08 * noise(g * 3.0 + 31.0);
  float road = roadDistance(g);
  float core = smoothstep(0.58, 0.7, along) * exp(-road * road / (spread * spread));
  return core * smoothstep(0.02, 0.06, riverEdge(g));
}
// Houses keep clear of the road; the density decides which 30 m lots are built.
float buildingDensity(vec2 g) {
  return villageDensity(g) * smoothstep(0.009, 0.014, roadDistance(g) - ROAD_HALF_WIDTH);
}

// Night emission: lit patches within settlements (2 cd/m², 2800 K).
float settlementLamp(vec2 g) {
  return step(0.2, villageDensity(g)) * step(0.94, hash(floor(g * 80.0)));
}

float forestDensity(vec2 g) {
  float strip = stripIndex(g);
  vec2 q = g + vec2(strip * 23.0, strip * 7.0);
  float across = abs(stripOffset(g)) / landHalfWidth();
  float woodland = fbm(q * 1.2 + 70.0) + 0.09 * (noise(q * 16.0) - 0.5) + 0.3 * smoothstep(0.4, 0.95, across);
  return smoothstep(0.6, 0.64, woodland) * smoothstep(0.08, 0.2, riverEdge(g));
}

// Baked land cover: tree probability, tree size, and binary tree and building
// occupancy. Averaged mip levels of a binary flag are zero only where the whole
// block is empty, which lets rays skip open land.
vec4 landCover(vec2 g) {
  float edge = landHalfWidth() - abs(stripOffset(g));
  if (edge < 0.012) return vec4(0.0);
  float river = riverEdge(g);
  float road = roadDistance(g) - ROAD_HALF_WIDTH;
  Field field = fieldAt(g);
  float village = villageDensity(g);
  float forest = forestDensity(g) * (1.0 - smoothstep(0.05, 0.2, village));
  float riparian = smoothstep(0.003, 0.006, river) * (1.0 - smoothstep(0.012, 0.024, river)) * (0.35 + 0.65 * noise(g * 40.0));
  float hedge = (1.0 - smoothstep(0.0015, 0.0045, field.hedge)) * smoothstep(0.25, 0.45, noise(g * 45.0 + 7.0));
  vec2 loneCell = floor(g / 0.06);
  vec2 lonePoint = (loneCell + 0.5) * 0.06;
  float lone = hash(loneCell + 211.0) < 0.05 ? 1.0 - smoothstep(0.003, 0.005, length(g - lonePoint)) : 0.0;
  float cover = max(max(forest, riparian * 0.9), max(hedge * 0.85, max(village * 0.14, lone)));
  cover *= step(0.003, river) * smoothstep(0.003, 0.007, road) * step(0.004, field.track);
  float size = forest > 0.5 ? 1.0 : riparian > 0.2 ? 0.7 : 0.45;
  // RGBA8 rounds below 0.5/255 to zero; occupancy covers every stored cover value.
  // Lots are built above 0.06 density. Occupancy is dilated by 15 m and uses a
  // lower threshold, so it covers houses (12 m from their lot center) and texels.
  float building = buildingDensity(g);
  for (int i = 0; i < 4; i++) building = max(building, buildingDensity(g + vec2(i < 2 ? 0.015 : -0.015, i % 2 == 0 ? 0.015 : -0.015)));
  return vec4(cover, size, step(0.03, building), step(0.4 / 255.0, cover));
}

float terrainAtGround(vec2 g) {
  return uCachedTerrain ? textureLod(uTerrain, groundAtlas(g), 0.0).r : groundHeight(g);
}
// Object anchors only need decimetres; full-precision float filtering is slow.
float anchorHeight(vec2 g) {
  return uCachedTerrain ? textureLod(uAnchorTerrain, groundAtlas(g), 0.0).r : groundHeight(g);
}

// Remove whole objects whose footprint overlaps the observer's clearing.
// Wrap the arc distance so the clearing also works across the atlas seam.
bool clearedObject(vec2 center, float extent, float top) {
  if (uObjectClearing.z <= 0.0) return false;
  vec2 offset = center - uObjectClearing.xy;
  offset.x = mod(offset.x + PI * uRadius, 2.0 * PI * uRadius) - PI * uRadius;
  return length(offset) < uObjectClearing.z + extent * uRadius / (uRadius - top);
}

// Crowns are ellipsoids above their anchor's terrain. A 3 × 3 neighborhood is
// exact to 4.9 m: crowns reach at most 5.5 m from a center jittered ±0.2 cells.
// `elevation` is the height of p above the wall, `scale` converts arc length.
float treeDistance(vec2 g, float elevation, float scale, out vec2 nearest) {
  vec2 base = floor(g / TREE_CELL);
  float best = 0.0049;
  nearest = vec2(-1e4);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 cell = base + vec2(i, j);
    vec4 a, b;
    hash8(cell, a, b);
    vec2 center = (cell + 0.5 + (a.xy - 0.5) * 0.4) * TREE_CELL;
    // Both fetches are issued before the branch so their latencies overlap.
    vec4 cover = coverAt(center);
    float anchor = anchorHeight(center);
    if (cover.r <= a.z) continue;
    float height = mix(0.008, 0.024, cover.g) * (0.72 + 0.5 * a.w);
    float conifer = step(0.8, b.x) * step(0.9, cover.g);
    float radius = clamp(height * mix(0.3, 0.17, conifer), 0.0022, 0.0048) * (0.85 + 0.3 * b.y);
    if (clearedObject(center, radius, anchor + height)) continue;
    float vertical = height * mix(0.4, 0.46, conifer);
    vec3 local = vec3((g.x - center.x) * scale, elevation - anchor - (height - vertical), g.y - center.y);
    vec3 r = vec3(radius, vertical, radius);
    float k0 = length(local / r), k1 = max(length(local / (r * r)), 1e-6);
    float d = k0 * (k0 - 1.0) / k1;
    if (d < best) {best = d; nearest = cell;}
  }
  return best;
}

// Gable-roofed houses stay at least 3 m inside their 30 m lots, so the own lot
// plus the distance to its border bounds every house. Walls continue 8 m below
// the anchor, so houses on slopes meet the ground.
float houseDistance(vec2 g, float elevation, float scale, out float roof, out vec2 cell) {
  cell = floor(g / HOUSE_CELL);
  vec2 f = g - cell * HOUSE_CELL;
  float bound = min(min(f.x, HOUSE_CELL - f.x) * scale, min(f.y, HOUSE_CELL - f.y)) + 0.003;
  roof = 0.0;
  vec4 a, b;
  hash8(cell + 61.0, a, b);
  vec2 center = (cell + 0.5) * HOUSE_CELL + (a.xy - 0.5) * 0.006;
  if (buildingDensity(center) * 1.3 <= max(0.08, a.z)) return bound;
  vec2 extent = vec2(0.0035 + 0.0015 * a.w, 0.005 + 0.0025 * b.x);
  float wall = 0.0045 + 0.0025 * b.y;
  float rise = extent.x * (0.55 + 0.35 * b.z);
  float anchor = anchorHeight(center);
  if (clearedObject(center, length(extent), anchor + wall + rise)) return bound;
  vec2 local = vec2((g.x - center.x) * scale, g.y - center.y);
  if (b.w > 0.7) local = local.yx;
  vec2 q = abs(local) - extent;
  float horizontal = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float above = elevation - anchor;
  float top = wall + rise * max(0.0, 1.0 - abs(local.x) / extent.x);
  // Roof slopes stay below 0.9, so 0.7 × vertical distance is a bound.
  float vertical = max((above - top) * 0.7, -above - 0.008);
  roof = step(horizontal, vertical);
  return min(max(horizontal, vertical), bound);
}

// Distance to trees and houses near p. Away from the canopy layer, or where a
// 16 × 16-texel occupancy mip is empty, a conservative bound is returned
// instead; it is never below 1 m, so it cannot register as a hit.
// kind: 0 none, 1 tree crown, 2 wall, 3 roof.
// Paths after their second scattering event skip land-use objects; they carry
// a few percent of the radiance and dominate the cost of marching crowns.
bool landObjects = true;
float objectDistance(vec3 p, float above, out float kind, out vec2 id) {
  kind = 0.0; id = vec2(0.0);
  if (!uLandUse || !landObjects || above < -0.003 || above > CANOPY_TOP + 0.01) return 1e3;
  vec2 g = groundCoordinates(p);
  // An empty 16 × 16-texel mip block leaves at least 48 m of occupancy-free
  // land around p; an 8 × 8 block leaves 24 m. An occupied texel lies within a
  // texel diagonal (8.5 m) of each tree anchor, whose crown reaches 5.5 m;
  // building occupancy is dilated over every house.
  vec2 uv = groundAtlas(g);
  vec4 occupied = textureLod(uLandCover, uv, 4.0);
  if (occupied.a > 0.0 && textureLod(uLandCover, uv, 3.0).a == 0.0) occupied.a = -1.0;
  float radius = length(p.xy), scale = radius / uRadius;
  vec2 treeCell, houseCell;
  float roof = 0.0;
  float tree = occupied.a > 0.0 ? treeDistance(g, uRadius - radius, scale, treeCell) : occupied.a < 0.0 ? 0.0095 : 0.033;
  float house = occupied.b > 0.0 ? houseDistance(g, uRadius - radius, scale, roof, houseCell) : 0.03;
  if (tree < house) {
    if (occupied.a > 0.0 && treeCell.x > -1e3) {kind = 1.0; id = treeCell;}
    return tree;
  }
  if (occupied.b > 0.0) {kind = roof > 0.5 ? 3.0 : 2.0; id = houseCell;}
  return house;
}

float terrainAt(vec3 p) {return terrainAtGround(groundCoordinates(p));}

// Terrain is a solid clipped to each land sector, including its exposed
// terrace sides. Switching heights abruptly at the edge was not a distance
// field: it invented radial normals on these angular faces.
float baseDistance(vec3 p, out float above) {
  float theta = atan(p.y, p.x);
  float radius = length(p.xy);
  float phase = (theta + PI * 0.5) / SECTOR_ANGLE;
  float margin = ((1.0 - uWindowFraction) * 0.5 - abs(fract(phase + 0.5) - 0.5)) * SECTOR_ANGLE;
  float landDistance = radius * sin(margin);
  above = uRadius - radius - terrainAt(p);
  float terrainDistance = max(above, -landDistance);
  return min(min(uRadius - radius, terrainDistance), uLength * 0.5 - abs(p.z));
}

float surfaceDistance(vec3 p) {
  float above, kind;
  vec2 id;
  float base = baseDistance(p, above);
  return min(base, objectDistance(p, above, kind, id));
}

// What a land hit belongs to: 0 terrain, 1 tree crown, 2 wall, 3 roof.
float landKind(vec3 p, out vec2 id) {
  float above, kind;
  float base = baseDistance(p, above);
  return objectDistance(p, above, kind, id) < base ? kind : 0.0;
}
