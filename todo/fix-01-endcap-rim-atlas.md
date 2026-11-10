# fix-01 — Surface-atlas texels on the endcap rim are erased at random

**Kind:** correctness · **Size:** small · **Confirmed on the GPU**

## Evidence

Surface atlas after 128 samples, default scene, green band, mean per group of
endcap texels (`correct` mode of the profiler; both endcaps agree):

| Texels | Count per endcap | Mean |
| --- | --- | --- |
| Inside, 0.85–1 R | 788 | 0.063 |
| On the rim, 75–100% inside the disc | 68 | 0.0032 |
| On the rim, 50–75% inside | 40 | 0.0002–0.0004 |
| On the rim, 25–50% inside | 40 | 0.0002–0.0003 |
| On the rim, under 25% inside | 64 | 0.00001 |
| Outside | 772 | 0 |

The 212 rim texels of each endcap are 20 to several thousand times darker
than the texels beside them. A texel is 125 m at the default radius.

## Cause

Each atlas sample starts at a random point inside its texel
(`atmosphere.glsl:129`). On an endcap, `surfaceAtlasPoint` returns false when
that point falls outside the disc (`geometry.glsl:178-180`), and `main` then
writes zero to the texel (`atmosphere.glsl:203`):

```glsl
if (!startSurfacePath(origin,direction)) {outColor=vec4(0.0);return;}
```

That discards the texel's running mean. A texel that is 30% outside the disc
is erased in 30% of the passes, and the next sample is averaged into zero
with weight `1/(history+1)`.

## What it does to the image

- The raster preview reads the atlas with a 3 × 3 tent
  (`preview-fragment.glsl:22-23`): a ring one to two texels wide where each
  endcap meets the wall has almost no scattered light.
- Camera paths that end on an endcap near its rim take their bounced light
  from those texels (`transport.glsl:606`).
- Bilinear filtering also blends in the zero texels outside the disc;
  `surfaceAtlasLight` clamps to the endcap's square, not to its disc
  (`geometry.glsl:163-168`).

## Proposed fix

1. Never write zero on a miss. Draw the start point inside the disc: retry a
   few times, then fall back to the nearest point of the disc within the
   texel. A rim texel then holds the mean over the part of it that exists.
   Keeping the previous value on a miss is not enough on its own: the mean
   uses the global sample count, so misses before the first hit still pull
   the texel toward zero.
2. Texels entirely outside the disc should not be read. Clamp the lookup
   radially (to the disc less half a texel), or fill those texels from their
   nearest inside neighbour.
3. The direct-sunlight bake (`preview-light.glsl:6`) has the same zero
   texels outside the disc and the same bilinear bleed, at a 31 m texel;
   apply the same clamp.

## How to verify

- `correct` mode of the profiler: rim groups within sampling noise of the
  inside ring.
- A browser test in `tests/browser/geometry.spec.ts`: fill the atlas with
  `openIsolatedPage`, read it back, and require every texel with any part
  inside the disc to be within a factor of two of the median of its inside
  neighbours.
- The preview shows no dark ring at the endcap junction (*Axis* view, looking
  at an endcap).
