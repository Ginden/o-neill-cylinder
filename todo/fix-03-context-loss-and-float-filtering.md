# fix-03 — Context loss and missing float filtering fail silently

**Kind:** robustness · **Size:** small · **Found by reading; not reproduced on a device**

## 1. No handling of a lost WebGL context

Nothing in `src/` listens for `webglcontextlost` or `webglcontextrestored`.
When the browser drops the context (a GPU process restart, a driver reset, a
draw that the GPU watchdog kills, memory pressure), three.js logs to the
console and every later call does nothing. The canvas keeps its last image,
the worker keeps looping, and the interface still says "Path tracing".

This renderer is more exposed than most:

- its first frames compile for tens of seconds (perf-03);
- it holds a lot of float textures. At *High* quality on a canvas of 4
  megapixels or more: 4 accumulation, 3 guide and 5 denoiser RGBA32F images
  of 64 MB each, plus about 160 MB of terrain and land-cover atlases, close
  to 1 GB. This is computed from the allocations in `renderer.ts`,
  `postprocess.ts` and `preview.ts`, not measured.

**Fix:** listen on the `OffscreenCanvas` in `worker.ts`. On loss, stop the
frame loop and post the existing `error` message, so the main thread shows
"Renderer unavailable" (`main.ts:229-239`). Restoring is optional: three.js
re-initialises its own state after `webglcontextrestored`, but the contents
of every target are gone, so each cache and atlas here would have to be
reset (`resetAccumulation`, `resetCache`, `resetSurface`,
`preview.invalidate(true, true)`).

**Verify:** a browser test that calls `WEBGL_lose_context.loseContext()` in
the worker (through a test-only message, or with `openIsolatedPage` on a
main-thread renderer) and waits for the error state.

## 2. Linear filtering of float textures is assumed

The constructor requires `EXT_color_buffer_float` (`renderer.ts:131`) and
nothing else. Several float textures are sampled with linear filtering:

- the weather field, which is the whole cloud model
  (`renderer.ts:198-204`, `common.glsl:78`);
- the R32F terrain atlas (`preview.ts:24`, `landscape.glsl:119-121`);
- the surface atlas (`geometry.glsl:167`);
- the accumulation target in the display and meter passes
  (`display.glsl:22-24`, `meter.glsl:9`).

That needs `OES_texture_float_linear`. Without it three.js only warns in the
console, and the textures sample as black. Desktop GPUs have the extension;
many phones do not.

**Fix:** require it at construction with a message like the existing one, or
fall back: half-float targets filter everywhere, and the weather field fits
in half floats. The README's requirements line should name whichever is
chosen.

**Verify:** construct the renderer with a context whose `getExtension`
returns null for that name and expect the error (a unit-level browser test
with `openIsolatedPage`).
