# perf-08 — Cache coefficients are recomputed on the render worker

**Kind:** responsiveness · **Size:** small

## Evidence

`diffusionCells` takes 11–15 ms per call (`scripts/benchmark-weather.mjs`:
10.8 ms humid, 14.9 ms dry; 14.6 ms on an evolved humid field). It runs on
the render worker after every weather snapshot while the cloud cache is in
use. Live weather delivers up to eight snapshots a second, so up to a tenth
of the worker's time goes here, in blocks during which it polls no fence,
draws no preview frame and acknowledges no state message.

Each snapshot also:

- builds the majorant grid (1.2–1.6 ms) and allocates a new `Data3DTexture`
  for it, disposing the old one (`renderer.ts:228-235`);
- uploads two 96 × 2048 RGBA float textures, 3 MB each
  (`renderer.ts:306-313`);
- scans 786,432 floats with `diffusion.some(...)` (0.2 ms).

## Where

- `renderer.ts:206-226` (`setWeather`), `:228-235` (`updateCloudBounds`),
  `:306-313` (`updateDiffusion`).
- `cache.ts:71-126` (`diffusionCells`).

## Proposed fix

Compute the coefficients and the majorants in the weather worker, which
already holds the field, and transfer them with the snapshot.

- The weather worker needs the particle tables' four node rows (extinction,
  scattering, asymmetry per population) and the settings; send those when
  they change, not per step.
- Return `deep` (whether any cell is diffusive) with the arrays instead of
  scanning on the render side.
- Keep the majorant texture and update its data in place; the dimensions do
  not change between snapshots (`setWeather` already does this for the
  weather texture, `renderer.ts:209-217`).
- The coefficients are only needed while `cacheActive`; skip the work when
  the cloud mass is zero.

## How to verify

- Time `setWeather` plus the next `updateDiffusion` on the render worker
  (`performance.now()` around both, in the profiler or a browser test):
  under 2 ms.
- `tests/cache.test.ts` (deep-cell rules) unchanged.
- `scripts/benchmark-weather.mjs` reports the same coefficient time, now
  spent in the weather worker.

## Note

This moves cost; it does not remove it. If perf-07 leaves the weather worker
saturated at high simulation speeds, refresh the coefficients every few
snapshots instead of every one.

## Resolution (2026-11-10)

Completed; protocol and measured results are in the
[task index](README.md#progress-2026-11-10). `src/weather/transport.ts` holds
the preparation function and optical settings key. A direct renderer caller
must call `prepareWeather` before `setWeather`; the application does that in
the weather worker. `tests/browser/weather-transport.spec.ts` checks actual
worker results, texture reuse, skipped work and installation time.
