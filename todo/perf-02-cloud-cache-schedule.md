# perf-02 — The cloud cache takes 71% of GPU time, converged or not

**Kind:** speed · **Size:** medium

## Evidence

*Humid afternoon*, paused, 940 × 800, valley view (ground view is the same):
2.55 samples per second. GPU time per camera sample:

| Pass | ms | Share |
| --- | --- | --- |
| Cloud cache | 233.0 | 71% |
| Camera | 75.5 | 23% |
| Surface atlas | 18.4 | 6% |
| Diffusion sweeps | 1.5 | — |
| Denoiser, display | 1.0 | — |

The cache ran 3 iterations per camera sample (78 ms each). It keeps that rate
forever: a paused, converged scene still spends 71% of its GPU time
refreshing a field that no longer changes.

## Why

`renderer.ts:479` advances one cache band with every camera band, and a cache
iteration is always 8 bands (`CACHE_BANDS`, line 39). With clouds on, a camera
sample is `ceil(pixels / 32768)` bands (line 410). So the ratio of cache work
to camera work is fixed at about 24,600 cache paths per 32,768 camera paths,
whatever the cache's state, and cache paths are far longer (64 droplet
scatterings against 2).

Iterations per camera sample therefore depend on the image size: 0.75 at
*Fast*, 3 here, 16 at 4 megapixels.

The share is wrong in both directions:

- **While warming** (192 iterations, `CACHE_WARMUP`), camera samples are a
  bounded running average of a field that is still wrong, yet they get 29% of
  the GPU. Warm-up takes 64 camera samples, 25 s; the cache alone would need
  192 × 78 ms = 15 s.
- **Once warm and static**, the cache needs only enough iterations to keep
  its noise from correlating camera samples.

## Proposed fix

Schedule cache bands from a budget, as the surface atlas already does
(`surfaceBudget`, `renderer.ts:492-493`), with the share chosen by state:

| State | Cache share of traced paths |
| --- | --- |
| Warming (`cacheIteration < CACHE_WARMUP`) | most of it, e.g. 7 cache bands per camera band |
| Live weather | as now |
| Paused and warm | a fraction, e.g. one cache band per 8 camera bands |

At one band per 8, a camera sample costs about 75 + 18 + 29 = 122 ms of GPU
time against 329 ms: roughly 2.5× the sample rate.

For the static case also consider stopping the exponential blend: with
`uCacheBlend = 1/32` the cache never converges below a fixed noise floor. An
exact running mean over iterations (as the atlas uses when not `bounded`)
would let the iteration rate fall to zero.

## How to verify

- `perf` mode of the profiler, *humid afternoon (paused)*: pass shares and
  samples per second, after warm-up (the current run measures while warming;
  add a case that first runs to `cacheIteration >= 192`).
- Time from a weather reset to `cacheIteration == 192`.
- Accuracy: the comparisons in the README's *Accuracy* section (extreme fog
  and *Humid afternoon* against exact paths). A slower-refreshing cache must
  not shift block means; compare per-sample variance too, because a cache
  that changes less often correlates successive camera samples.
- `tests/browser/clouds.spec.ts`.

## Risks

- The diffusion sweeps run at the end of each cache iteration
  (`renderer.ts:376-382`); keep them tied to iterations, not to camera bands.
- Bands must stay short: several cache bands in one submission lengthen it.
  Check navigation cadence with `scripts/benchmark.mjs`, or do perf-04 first.

## Related

- Sparse fields: cells that no droplet lookup can read could be skipped. In
  *Humid afternoon* 97.5% of cells are readable (191,693 of 196,608), so this
  is worth nothing there; measure a sparse field before trying it.
- perf-08 (coefficients computed on the render worker), perf-09 (walking
  resets the cache).
