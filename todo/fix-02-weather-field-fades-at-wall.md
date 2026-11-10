# fix-02 — Cloud density fades to zero at the curved wall, unevenly

**Kind:** correctness · **Size:** small · **Confirmed numerically**

## Evidence

A uniform fog (every active weather cell at density 1), sampled the way the
GPU samples the weather texture, at a given height above the wall
(`.local/bottleneck-wall-fade.mjs`; heights for a 4 km radius):

| Height above the wall | Minimum around | Mean | Land strips at 30° / 150° / 270° |
| --- | --- | --- | --- |
| 10 m | 0.05 | 0.58 | 0.58 / 0.58 / 1.00 |
| 100 m | 0.34 | 0.75 | 0.78 / 0.78 / 1.00 |
| 333 m (one cell) | 0.92 | 0.99 | 1.00 / 1.00 / 1.00 |

At eye level, two of the three land strips see 58% of the fog the model
holds, and the third sees all of it.

## Cause

The weather grid is Cartesian, 24 × 24 across the cylinder. Cells whose
centre lies outside the radius are inactive and stay zero in the snapshot
(`solver.ts:68`, `:329-349`). The GPU filters the texture trilinearly
(`common.glsl:75-79`), so every lookup within a cell of the wall blends
active cells with zeros. Where the wall runs along a grid axis (0°, 90°,
180°, 270°) the neighbour beyond it is the texture edge, which clamps, so
nothing fades; at other angles the neighbours are inactive cells.

The land strips are centred at 30°, 150° and 270°: one on a grid axis, two
off it.

Everything downstream reads the same faded field, so the renderer is
self-consistent: the transport, the majorants (`majorant.ts`) and the cache
coefficients (`cache.ts:57-64`). The error is in the field it is given.

## Proposed fix

In `snapshot()`, fill inactive cells that touch active ones with the mean of
their active neighbours, for the liquid-water channel at least. One layer is
enough if diagonal neighbours count: every lookup inside the cylinder has an
active corner (the one toward the axis), and its other corners are that
cell's neighbours. Statistics (`cloudMass`, `cloudFraction`) keep counting
active cells only.

The majorant grid then bounds the filled values automatically, as it is
built from the same array.

Not proposed: a cylindrical weather grid. It would remove the cause, and the
solver's wall boundary treatment with it, but it is a rewrite.

## How to verify

- A unit test in `tests/weather.test.ts`: a solver with uniform cloud, a
  snapshot, and a trilinear sample (clamped, as the GPU's) 10 m inside the
  wall at 0°, 30° and 45° all within a few percent of the interior value.
- The preset views (*Ground*, *Valley*, *Overlook*) stand on the 270° strip,
  where nothing fades today, so fog near the camera should not change there.
  A view from the 30° strip should show denser fog than before.

## Side effect to expect

Ground fog becomes denser on two strips, which makes cloudy scenes slower
there (more scattering) and may turn a few more cache cells diffusive.
