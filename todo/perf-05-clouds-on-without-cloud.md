# perf-05 — Clouds switched on cost 2× even when there is no cloud

**Kind:** speed · **Size:** small

## Evidence

Valley view, 940 × 800, weather field with zero condensate:

| | Clouds off | Clouds on, cloud mass 0 |
| --- | --- | --- |
| Samples per second | 9.52 | 4.66 |
| Camera pass per sample | 83.7 ms | 139.2 ms |
| Surface atlas per sample | 8.2 ms | 20.9 ms |
| Bands per sample | 4 | 23 |
| GPU busy | 0.887 | 0.752 |

This is not a brief transient: with the default 45% humidity the weather
model condensed nothing in 60 steps, six simulated minutes
(`.local/bottleneck-cpu.mjs`). Switching *Simulate clouds* on at the defaults
halves the sample rate for no visible change.

## Why

Everything keys off the `uClouds` uniform, which is the checkbox:

- `cellMajorant` (`transport.glsl:133-147`) walks the 333 m majorant grid
  cell by cell on every segment and shadow ray, each cell an iteration of the
  tracking loop, where clear air uses one global bound and one iteration.
- `weatherAt` samples the 3D texture at every tentative collision.
- `updateBands` (`renderer.ts:407-412`) cuts the image into 32,768-pixel
  bands, six times more submissions, each paying the polling wait of perf-04.

The renderer already knows the field is empty: `cacheActive` tests
`cloudMass > 0` (`renderer.ts:318-321`).

## Proposed fix

Drive the shader's cloud switch and the band size from "clouds are on **and**
the current field holds condensate", not from the checkbox alone. Set that in
`setWeather` (where `cloudMass` arrives) and in `apply`.

Points to settle:

- Live weather can cross from no cloud to some cloud. Accumulation is a
  bounded running average while weather is live, so the estimate follows; the
  band count changes, which resets the band in progress (`updateBands`
  already does that).
- `apply` writes `uClouds` from the settings every time
  (`renderer.ts:262-270`); the combined value must be written there too, or a
  settings change switches the grid walk back on.
- The diagnostic layers and `guides.glsl` read `uClouds` as well; an empty
  field gives the same result either way.

Beyond this, a partly cloudy field still walks every empty cell. A coarser
level of majorants (maximum over 4 × 4 × 4 cells) would let rays cross empty
regions in one step; measure a sparse field before doing it.

## How to verify

- `perf` mode of the profiler, *clouds on but none present*: samples per
  second and band count equal to the clear valley case.
- `tests/browser/clouds.spec.ts`; a test that a field gaining its first
  condensate switches the cloud path on without a settings change.
