# Performance and correctness tasks

Findings from a profiling and code-reading pass on 2026-11-10, at commit
`d4b171c`. Each file is one task with its evidence, the code it concerns, a
proposed fix and how to check it.

## Progress (2026-11-10)

- **00 complete:** `scripts/profile-gpu.mjs` tracks all four modes, accepts
  the benchmark environment, and checks private fields. Lint and all four
  modes passed on the RTX 5070. The correctness buckets now use exact
  disc/texel bounds, including slivers missed by the coverage probe.
- **fix-01 complete:** partial endcap texels sample only valid surface points;
  bilinear reads stay within the disc for both surface and direct-sun atlases.
  The browser regression checks every nonempty texel under constant irradiance,
  all 360 rim angles, nine tent offsets, both atlas sizes, and distinct cap
  lighting. All valid texels retain irradiance 1; filtered reads retain 1 with
  no cap mixing. Full transport at 128 atlas samples gives rim group means
  0.025–0.043 (previously 0.00001–0.0032), with entirely outside texels zero.
  Actual wall-adjacent lighting is lower than the wide 0.85–1 R ring (0.063),
  so the constant-irradiance test isolates the erased-mean regression from
  spatial lighting variation. The unsampled-Sun-route probe still changes no
  texels. `npm run check` and the rim browser test pass.
- **fix-02 complete:** snapshots extend liquid-water density into adjacent
  inactive cells. The regression samples uniform fog 10 m inside the wall at
  every degree around the cylinder and checks unchanged mass. Unit tests and
  all 11 cloud/geometry/worker browser tests passed.
- **fix-04 complete:** build base paths (including both favicons), unused image
  build arguments, first-sample exposure, atlas aspect ratios, single-channel
  weather transfers, and documentation corrected. `npm run check` passes
  (49 tests); a `/lab/` production build was inspected. Browser regressions
  cover weather uploads, geometry and live history.
- **fix-03 complete:** the worker stops and reports context loss; startup
  requires linear float filtering. Bundled Chromium tests reproduce a lost
  worker context and an absent filtering extension.
- **perf-05 complete:** shader tracking and band sizes follow actual
  condensate. Tests cover first condensation, evaporation, settings updates
  and checkbox toggles; the live-history/restart regression passes. GPU
  profiler: clear 84.48 ms camera / 4 bands, empty-cloud 84.38 ms / 4 bands.
- **perf-06 complete:** zero solar power skips forced air estimates, solar
  connections and Sun-hit MIS. All four transport browser tests pass. At
  1280 × 720, 64 exact samples per variant (no clouds or surface cache),
  disabling the new gates restores the original estimator: 62.95 ms camera
  before, 41.02 ms after. Across 32 blocks, the largest mean difference is
  1.76 combined standard errors; image means are 3.5132e-8 and 3.5028e-8.
  With the surface atlas enabled, the standard profiler measures 60.60 ms
  at night against 84.48 ms in daylight.

- **perf-07 complete:** achieved speed is measured from actual simulated and
  active real time and shown beside the speed slider below 90% of the request;
  pauses and superseded runs are excluded. The 32-substep cap is gone. Newton
  saturation adjustment reuses a parcel, and symmetric Gauss–Seidel CG reduces
  pressure iterations. Typed-index traversal was slower and rejected. A
  sqrt(1e-7) relative projection tolerance passes the existing divergence and
  energy tests. Measured steps improved from 22.8/31.9 ms (dry/humid) to
  16.2/17.5 ms with phase instrumentation; condensation fell from 11.2 to
  2.8 ms in humid air and pressure products from 26–30 to about 7.5 per step.
  The production rotation limit remains 0.3/Ω: 30-minute timestep trials
  rejected 0.5/Ω and 1/Ω because small-habitat cloud mass shifted 37–73%.
  At the original limit, optimized versus original final cloud mass differs
  by at most 0.062%, sampled peak wind by 0.11%, and divergence stays below
  1.6e-7 s⁻¹ across four habitats. `npm run check` passes (51 tests); browser
  checks verify a full 180-second job and the achieved-speed readout.

- **perf-08 complete:** the weather worker prepares majorants and diffusion
  arrays from four optical node rows per population, transferring the arrays
  and `deep` with each snapshot. Particle rows are resent only for changed
  radii; separate weather/optics generations reject stale replies. Settings
  and matching fields are applied together, including paused updates. The
  render worker reuses its majorant texture and only attaches prepared data.
  Worker-versus-serial coefficient differences are exactly zero, and 24
  repeated installations (including diffusion attachment) take at most
  0.10 ms in the browser check. Empty fields and vacuum skip coefficients.
  All 52 unit tests and 10 distinct worker/robustness browser tests pass;
  the hardware profiler remains at 2.55–2.56 samples/s for humid scenes.
  Coefficient work is moved, not removed: the CPU benchmark reports
  10.5–13.9 ms for its refresh.

- **perf-09 complete:** the 50 m clearing applies to camera paths and their
  shadows; cache/atlas paths retain the full landscape. Ground movement resets
  accumulation only. Preview frames advance a cloud-cache band as well as a
  surface band, using the coefficients already prepared off-thread. All four
  clearing browser tests pass; 24 moving frames advance both caches through
  three iterations without a reset. On the RTX 5070, 48 real humid-walking
  frames advance six iterations with a median 16.6 ms frame gap (57.7 fps
  including an initial 42.9 ms gap; compile/band latency work remains in
  perf-03/perf-04). A 23.9 kt uniform fog experiment at 1280 × 720 compares
  caches built 1 km apart: after eight cache iterations, every fluence/flux
  value is bit-identical. At 16 camera samples with the surface cache off,
  all 32 block means match exactly, including the clearing foreground;
  whole-image mean Y is 0.01066878 and foreground mean is 0.00202900.
  Re-enabling the old cache clearing changes seven field values (max
  1.54e-9), confirming that the fixture exercises affected objects. The
  cached-light geometric approximation is documented in the README.

All other tasks remain open. Current GPU baselines still show the cloudy
cache taking about 235 ms per camera sample and clear-scene GPU utilization
of 85%; these are not fixed by the completed work.

## How the numbers were measured

- GPU: RTX 5070 through ANGLE/OpenGL in headless Chromium, 940 × 800 traced
  pixels, *Balanced* quality, weather paused, one renderer at a time.
- CPU: Ryzen 9 5950X, Node 26.
- GPU time per pass comes from `EXT_disjoint_timer_query_webgl2` around every
  draw, tagged by pass (camera, cloud cache, surface atlas, guides, denoiser,
  display). "GPU busy" is the sum of those times over wall time.
- Cold shader compile times force a new program by changing one constant in
  the source, then block on `LINK_STATUS`.
- The GPU profiler is tracked as `scripts/profile-gpu.mjs` (`compile`,
  `perf`, `extra`, `correct`; needs `npm run dev`). Additional original
  probes remain in `.local/`: `bottleneck-cpu.mjs <repo path>` and
  `bottleneck-wall-fade.mjs`.

## Tasks, by expected effect

| Task | Kind | Evidence | Expected effect | Size |
| --- | --- | --- | --- | --- |
| [00](00-profiler-script.md) Track the pass profiler | tooling | every other task needs it to verify | — | S |
| [perf-01](perf-01-trees-and-houses.md) Trees and houses | speed, compile | 72% of camera path time; 64% of tracer compile time | about 2× samples/s in clear scenes | L |
| [perf-02](perf-02-cloud-cache-schedule.md) Cloud cache schedule | speed | cache is 71% of GPU time in cloudy scenes, converged or not | about 2.5× samples/s once warm; warm-up 25 s → 15 s | M |
| [perf-03](perf-03-shader-compile.md) Shader compile at startup | startup | 26.5 s cold, blocking; preview could show after 1.6 s | interactive preview after 2 s; 8 s less in total | M |
| [perf-04](perf-04-gpu-idle-between-bands.md) GPU idle between bands | speed | GPU busy 75–89% | +10–30% samples/s | M |
| [perf-05](perf-05-clouds-on-without-cloud.md) Clouds on, no cloud | speed | 4.7 against 9.5 samples/s with zero condensate | 2× in that state | S |
| [perf-06](perf-06-night-sun-sampling.md) Night samples a dark Sun | speed | Night costs the same 84 ms per sample as day | 1.5–2× at night | S |
| [perf-07](perf-07-weather-solver-speed.md) Weather speed | speed, correctness | at most 150–350× real time; slider offers 600× and drops the rest silently | honest speed; 2–3× faster steps | M |
| [perf-08](perf-08-cache-coefficients-off-render-worker.md) Cache coefficients on the render worker | responsiveness | 11–15 ms of CPU per weather snapshot | render worker stays free | S |
| [perf-09](perf-09-ground-walk-resets-caches.md) Walking resets the cloud cache | speed | each step in *Ground* view restarts a 25 s warm-up | usable cloudy walks | M |
| [perf-10](perf-10-idle-when-converged.md) Never idles | power | GPU stays about 90% busy on a still image indefinitely | idle GPU once converged | S |
| [fix-01](fix-01-endcap-rim-atlas.md) Endcap rim of the surface atlas | correctness | rim texels 20–300× darker than their neighbours | no dark ring at the endcap junction | S |
| [fix-02](fix-02-weather-field-fades-at-wall.md) Weather field fades at the wall | correctness | uniform fog reads 58% at 10 m above ground; two land strips of three | even ground fog | S |
| [fix-03](fix-03-context-loss-and-float-filtering.md) Context loss and float filtering | robustness | no handler, no capability check | an error message instead of a frozen or black canvas | S |
| [fix-04](fix-04-small-fixes.md) Small fixes | correctness, docs | six items, each verified in the code | — | S |

perf-01 and perf-03 overlap: the tree and house code is most of the tracer's
compile time, so do perf-01 first and re-measure before the deduplication part
of perf-03.

## Checked and not a bottleneck

- **Denoiser, display, exposure meter**: 1.0 + 0.07 + under 0.5 ms per sample
  against 84 ms of tracing.
- **View**: valley, ground, overlook and axis cost 76–84 ms per sample.
- **Air** (no clouds): 78 ms without atmosphere against 84 ms with it.
- **Guides pass**: 37 ms once after each camera move; the first sample
  appears about 125 ms after the 200 ms preview hold ends.
- **Atlas bakes** (terrain, anchors, land cover, sunlight): 3.4 ms of GPU
  time at 4096 × 3904 by timer query. This GPU is fast; not measured on an
  integrated one.
- **Mie tables**: 0.6 s (10 µm droplets) to 1.1 s (20 µm) on one thread,
  spread over up to four workers.
- **Bundle and CI**: 129 kB main and 668 kB render-worker bundles; CI took
  5–6 minutes per run in October and 12–15 on the two latest runs (not
  investigated).

## Suspected, not confirmed

- **Sunlight by routes that next-event estimation does not cover, in atlas
  and cache paths.** `transport.glsl:474` keeps such Sun hits when
  `s.order==0`. For camera paths that is the visible image of the Sun; for
  surface-atlas and cloud-cache paths the start point is a lit point, where
  the same light is deliberately left out for camera paths (two pane
  reflections, two mirrors, a pass through the habitat and back off a
  mirror). Omitting it there (`s.order==0 && !excludeDirect`) changed no
  texel in a million atlas paths (64 samples, Sun at azimuth 59°, elevation
  −37°), so if the inconsistency matters it is rarer than that test can see.
- **Pane-route search cost.** With the Sun at 59°/−37° a camera sample costs
  135 ms against 84 ms. The lighting differs too, so the search itself was not
  isolated; stub `paneRoutes` at run time (the profiler's `stub` helper) to
  split it.
- **Surface cache cost.** Camera samples cost 83.7 ms with the atlas and
  46.7 ms without (exact paths), 1.8× rather than the README's 1.5×. Most of
  it is the two extra traces through trees and houses, which perf-01 shrinks.
