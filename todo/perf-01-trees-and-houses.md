# perf-01 — Trees and houses are 72% of path-tracing time

**Kind:** speed and compile time · **Size:** large · **Do before:** perf-03

## Evidence

GPU time of the camera pass per sample, 940 × 800, clear daylight:

| Scene | With trees and houses | `uLandUse = false` |
| --- | --- | --- |
| Valley | 83.7 ms | 23.2 ms |
| Ground | 82.7 ms | 23.0 ms |

Samples per second go from 9.5 to 27.6. For comparison, removing the
atmosphere saves 6 ms.

Cold compile of the tracer: 18.3 s; with `objectDistance` stubbed, 6.5 s. The
object code is 64% of the compile time, because it is inlined at many sites.

The cost is in the march, not in shading the hit: leaving objects out of
`landNormal` (four more distance evaluations per hit) changed nothing
(85.4 ms), though that one inlined copy costs 3.5 s of compile time.

## Where

- `landscape.glsl:139-235`: `treeDistance` (3 × 3 cells, each a hash, a
  land-cover fetch and an anchor-height fetch), `houseDistance`
  (`buildingDensity` is three noise lookups and a road distance),
  `objectDistance`.
- `geometry.glsl:40-97`: `traceInterior` sphere-traces the union of terrain
  and objects, up to 320 steps, then bisects 12 times through
  `surfaceDistance`, a second inlined copy of `objectDistance`.
- `transport.glsl:559-560`, `surface.glsl:79-96`: `landKind` and `landNormal`
  evaluate the distance field five more times at each hit.
- A camera path with the surface cache traces five rays with objects: the
  primary ray, the forced single-scattering shadow ray, the shadow ray and
  bounce at the first surface, and the shadow ray at the second.

## Proposed fix

Intersect objects analytically instead of marching a distance field.

1. Walk the ray through the tree cells (8 m) and house lots (30 m) it crosses
   inside the canopy layer, with a 2D DDA in ground coordinates. Keep the
   occupancy mips to skip empty land and to bound the walk.
2. Per cell, intersect the one candidate: a crown is an axis-aligned
   ellipsoid (a quadratic); a house is a box with two roof planes (slabs).
   The result is an exact distance, an analytic normal and the kind and id.
3. March terrain alone as now, and take the nearer of the two hits. The
   bisection and the normal stencil then only ever see terrain.
4. `landKind` and `landNormal` at the hit no longer need objects; pass the
   kind, id and normal out of the trace.

This leaves one copy of the object code per `traceInterior` call site, where
there are now about ten across the tracer.

The cylinder's curvature matters: cells are in arc length at the wall and
`scale = radius / uRadius` shrinks them with height (`landscape.glsl:224`).
Over the 40 m canopy layer of a 4 km habitat that is 1%; treat the ray as
straight in ground coordinates within a cell and check the error, or
intersect in 3D using each object's own local frame.

Smaller, independent parts:

- Rays without objects (`landObjects == false`: surface-atlas paths and
  segments after the second scattering) still take the canopy step bound and
  fetch a land-cover mip per step, because `geometry.glsl:44` and `:85` test
  `uLandUse` and not `landObjects`.
- Shadow rays only need to know whether anything is hit; they can stop at the
  first object without the kind, id or normal.

## How to verify

- `perf` mode of the profiler: the camera pass in the valley and ground
  scenes should approach the `uLandUse = false` figure (23 ms); expect
  35–45 ms.
- `extra` mode: tracer compile time.
- Correctness: render exact paths (`uSurfaceCache = false`, no cloud) before
  and after at 1280 × 720 and compare block means and per-sample variance, as
  `AGENTS.md` prescribes. Crown silhouettes will differ by the curvature
  approximation only.
- `tests/browser/geometry.spec.ts` and `clearing.spec.ts` (the observer's
  clearing removes whole objects by footprint: keep `clearedObject`).

## Risks

- The denoiser's guides (`guides.glsl`) use the same functions; give them the
  same hit record.
- `occupancyClearance` assumes the atlas texel sizes; a DDA that trusts the
  mips must keep its margins (`landscape.glsl:195-205`).
- Keep the single call site per large function (`AGENTS.md`).
