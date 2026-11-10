# 00 — Track the pass profiler in `scripts/`

**Kind:** tooling · **Size:** small

## Why

`scripts/benchmark.mjs` reports samples per second and UI cadence for one
scene. It cannot say which pass the time goes to, how busy the GPU is, or how
long a cold compile takes, and every task in this folder needs one of those
numbers to be verified. The script that produced them is untracked
(`.local/bottleneck-profile.mjs`).

## What to do

1. Move `.local/bottleneck-profile.mjs` to `scripts/profile-gpu.mjs`. Keep its
   modes:
   - `compile`: cold compile and link time per program, sequential and with
     all programs submitted at once;
   - `perf`: GPU milliseconds per sample by pass, GPU busy fraction and fence
     polls for a set of scenes (views, no trees, no atmosphere, exact paths,
     night, clouds on without cloud, paused humid weather);
   - `extra`: first sample after a camera move, atlas bake time, and tracer
     compile time with one function stubbed;
   - `correct`: surface-atlas checks (endcap rim; unsampled Sun routes).
2. Take the browser path and GPU flags from the same environment variables as
   `scripts/benchmark.mjs` (`PLAYWRIGHT_CHROMIUM_EXECUTABLE`,
   `BENCHMARK_GPU_ARGS`, `BENCHMARK_URL`) instead of the hard-coded
   `/usr/bin/chromium-browser`.
3. Make it pass `npm run lint` (the `/* global … */` header the other scripts
   use).
4. Add it to the README's development table and to `AGENTS.md`'s command
   table, with the rule that applies to all GPU runs: one renderer at a time.

## Notes for whoever does it

- `gl.finish()` does not wait for the GPU in Chrome. Time GPU work with timer
  queries, not wall time around `finish`.
- The script reaches into private fields of `HabitatRenderer` (`scene`,
  `band`, `surfaceTargets`, …). That is acceptable for a profiler, but it
  breaks silently when a field is renamed: have it throw when a field it needs
  is `undefined`.
- It imports `/src/render/renderer.ts` in the page and blocks `src/main.ts`,
  like `tests/browser/isolated.ts`. It drives `render()` from the main thread,
  so it does not measure the worker boundary; `scripts/benchmark.mjs` does.
