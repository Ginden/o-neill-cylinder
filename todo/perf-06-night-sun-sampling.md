# perf-06 — At night every path still samples a Sun that emits nothing

**Kind:** speed · **Size:** small

## Evidence

Valley view, 940 × 800, camera pass per sample: 83.65 ms in daylight,
83.68 ms with solar power 0 (the *Night* preset).

## Why

`solarSpectrum` is the blackbody times `uSolarPower`
(`transport.glsl:82`), so at night `directLight` returns zero. It does all
its work first (`transport.glsl:330-392`):

- samples the solar disk and tests up to four routes through the hull and
  mirrors (`openRoutes`), each following up to eight exterior bounces;
- searches for pane reflections (`paneRoutes`);
- tracks the medium and marches terrain, trees and houses along the shadow
  ray (`shadowTransmission`, `traceInterior`).

A camera path makes three such connections: the forced single-scattering
estimate on the camera segment and one at each of its two surfaces. Of its
five marches through the scene, three are shadow rays toward the dark Sun.

## Proposed fix

When `uSolarPower == 0`:

- skip the connection in `advancePath` (`connect = false`) and the forced
  estimate (`s.forced = false` in `startPath`);
- skip the Sun-hit weight computation (`transport.glsl:454-475`), which also
  calls `openRoutes` and `paneRoutes`.

Test the uniform once per path, outside the connection, so `directLight`
keeps its single call site. Between 0 and 2% solar power the Sun still lights
the scene alongside the lamps (`uSolarPower < 0.02` switches the lamps on):
only exactly zero may skip.

Expect 1.5–2× the sample rate at night.

## How to verify

- `perf` mode of the profiler, *night*: camera pass well below the daylight
  figure.
- The image must not change: compare block means of a night render before and
  after (exact paths, `uSurfaceCache = false`).
- `tests/browser/transport.spec.ts`.

## Follow-up, separate

Lamps are found only by paths that happen to hit a lit patch (6% of village
texels); there is no next-event estimation for them. Night images are
therefore noisy however fast the samples are. Sampling lamps directly is a
larger change and not part of this task.
