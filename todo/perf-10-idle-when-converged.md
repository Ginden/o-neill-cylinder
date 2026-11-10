# perf-10 — A still image keeps the GPU busy forever

**Kind:** power · **Size:** small · **Needs a decision**

## Evidence

`render()` has no stopping condition (`renderer.ts:432-508`): while the tab
is visible and the camera still, it traces sample after sample. The GPU busy
fraction measured 0.89–0.96 in every static scene, and it stays there at
sample 10,000 as at sample 10. Only the surface atlas has a cap
(`SURFACE_SAMPLES = 4096`).

At 9.5 samples per second the default view passes 1,000 samples in under two
minutes. After that the displayed image changes by less than the display can
show, and the machine still runs its GPU flat out.

## Proposed fix

Stop tracing when the image has converged, and resume on any change.

- Per-pixel second moments are already accumulated (alpha of both targets,
  `atmosphere.glsl:181-193`). Every N samples, estimate the image's relative
  standard error from them: a 32 × 32 reduction like the exposure meter's
  (`postprocess.ts:43-71`), read back asynchronously.
- Below a threshold, or above a sample cap, stop submitting camera bands.
  Keep the frame loop on `requestAnimationFrame` so input still wakes it.
- Anything that calls `resetAccumulation` resumes. Live weather never stops.
- Show the state: "Converged · 2,048 samples".

## The decision

- The threshold, and whether to expose it. People comparing light levels may
  want to keep refining past the display's needs; the light meter reads raw
  values. A setting ("stop when converged", on by default) covers both.
- A plain sample cap is simpler but wrong for both easy and hard scenes.

## How to verify

- Profiler: GPU busy falls to about zero after the stop; samples stop
  increasing; a camera move resumes within a frame.
- Browser tests wait for sample counts (`untilRender` with `samplesAbove`):
  check none waits for a count above the cap in a scene that now stops.
