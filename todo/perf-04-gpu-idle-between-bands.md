# perf-04 — The GPU idles 11–25% of the time between bands

**Kind:** speed · **Size:** medium

## Evidence

GPU busy fraction (timed GPU work over wall time) while refining:

| Scene | Bands per sample | GPU ms per band | GPU busy | Idle |
| --- | --- | --- | --- | --- |
| Clear valley | 4 | 23 | 0.887 | 11% |
| Clear, no trees | 4 | 7 | 0.75 | 25% |
| Clouds on, none present | 23 | 7 | 0.752 | 25% |
| Humid afternoon | 23 | 14 | 0.84–0.86 | 15% |

In the clear valley, 297 calls of `render()` produced 48 bands; the other 249
found the fence unsignalled and returned. Yielding through a `MessageChannel`
instead of `setTimeout(0)` raised the busy fraction to 0.959 (about 7% more
samples per second for the same GPU work: 91.9 ms per sample against 98.4),
at the price of 90,000 polls per second on one core.

## Why

- `render()` submits one band, creates a fence and returns; the next band is
  submitted only after a later poll finds the fence signalled
  (`renderer.ts:444-449`). Between the GPU finishing and that poll, it has
  nothing queued.
- The worker polls with `setTimeout(0)` (`worker.ts:110`). Nested timers are
  clamped to about 4 ms, so the GPU waits 2–3 ms per band on average.
- Band size is a fixed pixel count: 196,608 without clouds, 32,768 with
  (`renderer.ts:410`). Those suit one GPU. Where a band takes 7 ms, the wait
  is a quarter of the time; on a GPU ten times slower a clear band takes
  230 ms and the fence no longer protects the interface.

## Proposed fix

1. **Keep two bands in flight.** Hold a fence per submitted band; submit the
   next band when at most one is outstanding. The GPU always has work queued
   while the worker sleeps on its timer. Bands of one sample write disjoint
   scissor rows of the same target and read only the previous sample's
   target, so they are independent; the display pass after the last band is
   already ordered behind it in the queue.
2. **Size bands by measured time.** Record submit-to-signal time per band and
   steer the band height toward a target (for example 8–12 ms), replacing the
   two constants. Slow GPUs get short bands, fast ones fewer polls. Cache and
   atlas bands need the same treatment (`CACHE_BANDS`, `SURFACE_BANDS`).

With both, worst-case latency before a preview frame is two bands at the
target time, about what one clear band costs now.

A `MessageChannel` yield alone is not the fix: it spins a core.

## How to verify

- `perf` mode of the profiler: GPU busy at or above 0.97 in all four scenes.
- `node scripts/benchmark.mjs` on a real GPU: `uiFPS` stays 60 and `maxGapMs`
  about 17 in the steady, navigation and particle phases.
- Time from pointer-down to the first preview frame does not grow: measure
  from a `state` message with `interacting: true` to the next `mode:
  'preview'` report.
- Browser tests on SwiftShader, where one band can take seconds: band sizing
  must not shrink bands below a floor that makes samples take thousands of
  submissions.

## Risks

- The fence check must not let a GPU backlog build (`renderer.ts:445-446`
  explains why). Two bands is the bound; do not make it configurable.
- `AGENTS.md` and the README describe "one submission per frame"; update
  both.
