import type { Settings } from './settings';

/** CPU copy of the procedural terrain in common.glsl, for standing on it. All
 * lengths are kilometres; `g` is ground coordinates (arc length from the +Y
 * window centre at the wall, axial z). */

type Terrain = Pick<Settings, 'radius' | 'length' | 'windowFraction' | 'terrainHeight'>;

/** Ground atlas size: roughly square texels, at most `limit` on a side. Both
 * sides are multiples of 32, so each occupancy mip texel covers exactly the
 * 2^level × 2^level base texels below it. */
export function atlasSize(radius: number, length: number, limit: number): [number, number] {
  const height = Math.round(limit * Math.min(1, length / (2 * Math.PI * radius)) / 32) * 32;
  return [limit, Math.max(256, height)];
}
/** The terrain and land-cover atlases the GPU bakes for these settings. */
export const terrainAtlasSize = (s: Pick<Settings, 'radius' | 'length' | 'quality'>) =>
  atlasSize(s.radius, s.length, s.quality === 'fast' ? 2048 : 4096);
type Vec2 = [number, number];
const SECTOR_ANGLE = 2 * Math.PI / 3;

// PCG2D lattice hash with 32-bit unsigned arithmetic, as in latticeHash().
function latticeHash(x: number, y: number): [number, number] {
  let a = (Math.imul((Math.floor(x) + 1073741824) | 0, 1664525) + 1013904223) >>> 0;
  let b = (Math.imul((Math.floor(y) + 1073741824) | 0, 1664525) + 1013904223) >>> 0;
  for (let round = 0; round < 2; round++) {
    a = (a + Math.imul(b, 1664525)) >>> 0;
    b = (b + Math.imul(a, 1664525)) >>> 0;
    a = (a ^ (a >>> 16)) >>> 0;
    b = (b ^ (b >>> 16)) >>> 0;
  }
  return [a, b];
}
const hash = (x: number, y: number) => (latticeHash(x, y)[0] >>> 8) / 16777216;
const fract = (v: number) => v - Math.floor(v);
const smoothstep = (lo: number, hi: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const bottom = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * fx;
  const top = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * fx;
  return bottom + (top - bottom) * fy;
}

// Octaves rotate by mat2(0.8, -0.6, 0.6, 0.8), column-major as in GLSL.
const rotate = ([x, y]: Vec2, scale: number, offset: number): Vec2 =>
  [(0.8 * x + 0.6 * y) * scale + offset, (-0.6 * x + 0.8 * y) * scale + offset];

function fbm(p: Vec2) {
  let result = 0, weight = 0.5;
  for (let j = 0; j < 4; j++) {
    result += weight * noise(...p);
    p = rotate(p, 2.03, 8.2);
    weight *= 0.5;
  }
  return result;
}

function noiseGradient(x: number, y: number): [number, number, number] {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const dx = 6 * fx * (1 - fx), dy = 6 * fy * (1 - fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return [a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy,
    dx * ((b - a) + (a - b - c + d) * uy), dy * ((c - a) + (a - b - c + d) * ux)];
}

function erodedFbm(p: Vec2) {
  let result = 0, weight = 0.5, sx = 0, sy = 0;
  for (let j = 0; j < 7; j++) {
    const [value, gx, gy] = noiseGradient(...p);
    sx += gx; sy += gy;
    result += weight * value / (1 + sx * sx + sy * sy);
    p = rotate(p, 2, 3.7);
    weight *= 0.5;
  }
  return result;
}

const stripIndex = (g: Vec2, s: Terrain) => Math.floor(g[0] / (SECTOR_ANGLE * s.radius));
const stripOffset = (g: Vec2, s: Terrain) => g[0] - (stripIndex(g, s) + 0.5) * SECTOR_ANGLE * s.radius;
const landHalfWidth = (s: Terrain) => (1 - s.windowFraction) * SECTOR_ANGLE * s.radius * 0.5;

function riverEdge(g: Vec2, s: Terrain) {
  const strip = stripIndex(g, s), z = g[1];
  const amplitude = Math.min(1, Math.max(0.15, landHalfWidth(s) / 2.2));
  const center = amplitude * (0.22 * Math.sin(z * 0.8 + strip * 2.1) + 0.12 * Math.sin(z * 1.7 + strip * 4.3) + 0.035 * Math.sin(z * 4.3 + strip));
  return Math.abs(stripOffset(g, s) - center) - (0.031 + 0.008 * Math.sin(z * 0.53 + strip * 1.3));
}

/** groundHeight() in common.glsl: terrain height above the wall. */
export function groundHeight(g: Vec2, s: Terrain) {
  const strip = stripIndex(g, s);
  const across = Math.abs(stripOffset(g, s)) / landHalfWidth(s);
  const q: Vec2 = [g[0] + strip * 37, g[1] + strip * 11];
  const warp = [fbm([q[0] * 0.4 + 3.1, q[1] * 0.4 + 3.1]) - 0.5, fbm([q[0] * 0.4 + 9.7, q[1] * 0.4 + 9.7]) - 0.5];
  const hills = erodedFbm([q[0] * 1.25 + warp[0] * 1.6 + 21, q[1] * 0.6 + warp[1] * 1.6 + 21]);
  const rise = smoothstep(0.1, 1, across);
  const floodplain = smoothstep(0.04, 0.42, Math.max(0, riverEdge(g, s)));
  const relief = 0.1 + 0.45 * rise * rise + 0.95 * hills * hills * (0.4 + 0.6 * rise);
  return s.terrainHeight * (0.03 + floodplain * Math.min(relief, 1.75));
}

/** Whether the wall at angle `theta` is a window band (windowAt in common.glsl). */
export function windowAt(theta: number, s: Pick<Settings, 'windowFraction'>) {
  return Math.abs(fract((theta + Math.PI / 2) / SECTOR_ANGLE + 0.5) - 0.5) > (1 - s.windowFraction) * 0.5;
}

/** Height of the drawn surface below the wall point at `theta`, z: the GPU
 * bilinearly filters a `width` × `height` atlas of groundHeight at texel
 * centres, wrapping around and clamped along the axis. Window bands are the
 * pane itself. */
export function surfaceHeight(theta: number, z: number, s: Terrain, [width, height]: [number, number]) {
  if (s.terrainHeight <= 0 || windowAt(theta, s)) return 0;
  const u = fract((theta - Math.PI / 2) / (2 * Math.PI)) * width - 0.5;
  const v = Math.min(height - 0.5, Math.max(0.5, (z / s.length + 0.5) * height)) - 0.5;
  const i = Math.floor(u), j = Math.min(height - 2, Math.floor(v)), fu = u - i, fv = v - j;
  const at = (x: number, y: number) => groundHeight([((x % width + width) % width + 0.5) / width * 2 * Math.PI * s.radius, ((y + 0.5) / height - 0.5) * s.length], s);
  return (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv;
}
