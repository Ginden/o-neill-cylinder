# perf-03 — Cold start blocks the render worker for 26 s

**Kind:** startup · **Size:** medium · **Do after:** perf-01 (for part 2)

## Evidence

Cold compile and link time per program (RTX 5070, NVIDIA driver, source
changed to defeat the caches):

| Program | One at a time | All submitted at once: ready at |
| --- | --- | --- |
| Terrain bake | 0.25 s | 0.2 s |
| Sun bake | 1.2 s | 1.5 s |
| Raster preview | 0.35 s | 1.6 s |
| Guides | 6.4 s | 6.8 s |
| Path tracer | 18.3 s | 18.2 s |
| Diffusion, denoiser, display, meter | 0.04 s | 18.2 s (queued behind the tracer) |
| **Total** | **26.5 s** | **18.2 s** |

`KHR_parallel_shader_compile` is available. Submitting a program takes about
1 ms; the time is spent when three.js first uses it and asks for
`LINK_STATUS`, which blocks.

Today each program compiles on first use, inside `render()`, on the render
worker. The preview shows after about 2 s; 200 ms later the first traced
sample asks for the guides and tracer programs and the worker blocks for 25 s.
During that time it cannot draw the preview or acknowledge state messages, so
the image is frozen and dragging does nothing. The README says 10–20 s.

Tracer compile time with one part stubbed (18.3 s complete):

| Stubbed | Compile | Saved |
| --- | --- | --- |
| `objectDistance` (trees, houses) | 6.5 s | 11.7 s |
| `diagnosticColor` | 14.1 s | 4.2 s |
| Objects in `landNormal` | 14.8 s | 3.5 s |
| `paneRoutes` | 15.3 s | 3.0 s |

## Where

- `worker.ts:41-56`: the renderer is not created until the Mie tables arrive.
- `renderer.ts:432-508`: programs compile on first draw.
- `AGENTS.md` forbids a second call site of `traceInterior`; the tracer has
  three: `transport.glsl:499` (paths), `transport.glsl:374` (shadow rays) and
  `atmosphere.glsl:159` (`diagnosticColor`). It also has two each of
  `shadowTransmission` (`transport.glsl:372`, `:526`) and `paneRoutes`
  (`:335`, `:465`), and three of `openRoutes`.

## Proposed fix

**1. Compile without blocking.**

- Submit every program at construction (`renderer.compileAsync`, or
  `compile` and then poll `COMPLETION_STATUS_KHR` through
  `WebGLProgram.isReady()`).
- While the tracer or guides program is not ready, keep drawing the raster
  preview and keep acknowledging state. Report the state in the stats message
  so the interface can say "Compiling the path tracer…" in place of a frozen
  image.
- Create the renderer before the Mie tables arrive (placeholder 1 × 1 phase
  textures exist already, `renderer.ts:59`), so compilation and the tables run
  side by side. Only path tracing needs to wait for the tables.

This shows an interactive preview after about 2 s and saves 8 s in total.

**2. Remove duplicate inlined copies** (after perf-01, which changes the
largest of them).

- Give the diagnostic layers their own small program. They need one
  `traceInterior` and no transport; that takes 4.2 s out of the tracer.
- Merge `landKind` and `landNormal` at a hit into one loop over five points,
  or make them unnecessary (perf-01).
- `startSurfacePath` calls `interiorNormal`, which compiles a full
  `landKind` + `landNormal` with objects for paths that have objects switched
  off (`atmosphere.glsl:130-131`).
- Share one call site of `openRoutes` + `paneRoutes` between `directLight`
  and the Sun-hit weight in `advancePath`.

The guides program (6.4 s) repeats the same functions; the same changes
shrink it.

## How to verify

- `compile` and `extra` modes of the profiler for cold times.
- A browser test that the preview responds to a camera move while the tracer
  compiles (SwiftShader compiles slowly, which helps here): wait for a
  `renderstate` event with `mode: 'preview'` after a drag, before the first
  `mode: 'path'` sample.
- CI time: SwiftShader compiles these programs in every browser test file.

## Risks

- `compileAsync` only avoids blocking where the extension exists. Without it
  the behaviour stays as now.
- Programs are keyed by render-target state in three.js (output colour
  space); precompile with the target that the pass will draw to, or the first
  draw compiles a second variant.
- Update the README's "expect 10–20 s" afterwards.
