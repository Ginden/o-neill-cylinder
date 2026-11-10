# perf-07 — The weather cannot run as fast as the slider says

**Kind:** speed and correctness · **Size:** medium

## Evidence

One solver step on a Ryzen 9 5950X (`.local/bottleneck-cpu.mjs`), 21,504
active cells:

| Scene | Step | Pressure projection | Condensation | Advection | Simulated per step | Best speed |
| --- | --- | --- | --- | --- | --- | --- |
| Default, dry (45%) | 23.9 ms | 18.0 ms | 0.7 ms | 2.5 ms | 6.06 s | 254× |
| Default, humid (78%) | 30.0 ms | 15.1 ms | 10.7 ms | 1.8 ms | 6.06 s | 202× |
| Giant cylinder, humid | 29.8 ms | 10.5 ms | 15.2 ms | 1.8 ms | 10.49 s | 352× |
| Small cylinder | 20.4 ms | 15.4 ms | 0.8 ms | 1.8 ms | 3.03 s | 149× |

"Best speed" is simulated time over compute time, before snapshots and
message passing. The *Simulation speed* slider goes to 600× and defaults to
120×.

## The correctness part

When the solver cannot keep up, simulated time is dropped without a trace:

- `weather/client.ts:40` sends at most 0.3 s of real time per message; while
  the worker is busy the accumulator keeps growing and the excess is thrown
  away when the next message is built.
- `weather/worker.ts:20` runs at most 32 substeps per message. At 600× a
  message asks for 180 s: 30 substeps at the defaults, but 59 in the small
  cylinder, so 46% is dropped there even before timing matters.

The interface still shows the requested speed. On this CPU the humid default
tops out near 200×; a CPU half as fast falls short of the default 120×.

## Where the time goes

- **Time step.** `solver.ts:297` limits `dt` to `0.3 / ω`: 6.06 s at 1 g and
  4 km. That is the binding limit in every scene above; the advection limit
  and the 20 s cap never applied. Coriolis rotation is integrated exactly
  (`solver.ts:300-313`), so the limit guards only the splitting between
  rotation, buoyancy and advection.
- **Projection.** 26–31 conjugate-gradient iterations per step with a
  diagonal preconditioner; the matrix product is 10–12 ms of the 15–18 ms
  (`solver.ts:221-277`). Values are `Float64Array`, vectors `Float32Array`,
  and every loop iterates a plain array of cell indices.
- **Condensation.** `equilibrate` (`physics.ts:50-72`) bisects 24 times with
  an `exp` each for every saturated parcel and returns a new object per cell
  (`solver.ts:139-146`): 0.7 ms dry, 10–15 ms cloudy.

## Proposed fix

1. **Be honest about speed.** Report achieved speed (simulated seconds per
   real second) in `WeatherStats` and show it next to the slider when it
   falls short; or carry unsimulated time over instead of discarding it, up
   to a bound. Remove the silent 32-substep cap or count what it drops.
2. **Condensation.** Replace bisection with Newton iterations on the
   saturation equation (the derivative of the Magnus formula is closed form;
   two or three iterations reach the same tolerance), and write results into
   the fields without allocating.
3. **Projection.** Try, in this order, and measure each: an incomplete
   Cholesky or symmetric Gauss–Seidel preconditioner; typed index arrays
   (`Int32Array` of active cells) in the loops; a looser tolerance than
   10⁻⁴ relative divergence if the weather tests allow it.
4. **Time step.** Test whether `0.3 / ω` can be relaxed, for example to
   `1 / ω`, by comparing cloud mass, peak wind and divergence over a long
   run. Up to 3.3× more simulated time per step at the defaults.

## How to verify

- `node scripts/benchmark-weather.mjs` before and after (it takes
  `BENCHMARK_SOURCE` for another checkout).
- `tests/weather.test.ts` and `tests/physics.test.ts`: water and moist static
  energy conservation, divergence after projection.
- A test for item 1: at a requested speed the solver cannot reach, the
  reported speed is the achieved one.

## Resolution (2026-11-10)

Completed; measured results and rejected alternatives are recorded in
[the task index](README.md#progress-2026-11-10). Reproduce phase timings with
`node scripts/benchmark-weather.mjs`. Use `BENCHMARK_SOURCE` for an earlier
checkout, and `BENCHMARK_DURATION=1800` for the timestep study; production
uses 0.3/Ω throughout. `BENCHMARK_ROTATIONS=0.3` selects only that reference.
The timestep-study override is confined to direct solver calls from the
benchmark; the weather worker always uses the production default.
