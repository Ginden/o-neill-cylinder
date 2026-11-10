# perf-09 — Every step in Ground view restarts the cloud cache

**Kind:** speed · **Size:** medium · **Needs a decision**

## Evidence

In *Ground* view the observer's clearing (trees and houses within 50 m are
removed) follows the camera. `updateObjectClearing` (`renderer.ts:334-345`)
resets accumulation on every change of position and, while the cloud cache is
active, also the cache and the surface atlas.

The cache needs 192 iterations to count as warm. At 940 × 800 that measured
3 iterations per camera sample at 2.55 samples per second: 25 s. So in cloudy
weather, walking keeps the cache permanently cold; the README says as much
("Walking in Ground view also resets it").

## Why it was done

"All rays see the same clearing, including shadows and cloud lighting"
(`renderer.ts:341-343`). Cache paths trace trees and houses on their first
two segments, so the cached light depends, slightly, on which objects stand
near the observer.

## The decision

How much can 50 m of missing trees change the cloud cache and the atlas?

- Cache cells are 4 m to hundreds of metres radially, 260 m around and 375 m
  along (32 × 96 × 64 cells in a 4 km × 24 km habitat). The clearing covers
  about 8% of one cell's footprint.
- The clear-air surface atlas already ignores objects entirely.

Proposed: make the clearing apply to camera paths only. Cache and atlas paths
see every object, wherever the observer is, so neither depends on the camera
and neither resets when it moves. The light the observer sees is then
inconsistent only inside the clearing: the cached light there was computed
with trees that the camera's own rays no longer hit.

If exact consistency matters more than walking, leave this as it is and close
the task.

## Implementation, if accepted

- A global switch in the shader beside `landObjects`
  (`landscape.glsl:212`), set in `startCachePath` and `startSurfacePath`,
  that makes `clearedObject` return false.
- In `updateObjectClearing`, reset accumulation only.
- Remove the README sentences about walking resetting the cache.

## How to verify

- `tests/browser/clearing.spec.ts`.
- Accuracy: in *Ground* view with fog, compare the image with the cache
  frozen from another camera position against one rebuilt in place (block
  means over the whole image and over the part showing the clearing).
- Walking in *Humid afternoon* keeps `cacheIteration` rising.
