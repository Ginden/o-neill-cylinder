# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

O'Neill Atmosphere Lab: a browser spectral path tracer (WebGL2 via three.js, no backend) for the light inside a rotating space habitat, with a coarse moist-convection weather model. `README.md` explains the physics, validation numbers and known limits; keep it current when behaviour changes.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on 127.0.0.1:5173 |
| `npm run check` | ESLint, vitest unit tests, `tsc`, production build (what CI runs first) |
| `npx vitest run tests/optics.test.ts -t 'name'` | One unit test file / test |
| `npm run test:browser` | Playwright browser tests on SwiftShader (starts or reuses the dev server on 5173) |
| `npx playwright test tests/browser/transport.spec.ts -g 'title'` | One browser test |
| `npm run test:render` | Fast filter/cloud subset of the browser tests |
| `node scripts/benchmark.mjs` | samples/s and UI cadence on a real GPU (see README for env vars) |

Browser tests: CI uses Playwright's bundled headless Chromium (`npx playwright install chromium`); `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium-browser` uses the system one, which is faster and can hide CI timing problems, so reproduce CI failures with the bundled browser. Don't edit files while they run (Vite hot reload breaks them). For a real GPU in headless Chromium use `--use-angle=gl-egl --ignore-gpu-blocklist --enable-gpu --headless=new`; run one GPU renderer at a time and keep draws bounded.

CI is a self-hosted Gitea, not GitHub (`gh` does not work): `tea actions runs list|view|logs <id> --repo nuc/o-neill-cylinder`. `ci.yml` runs check + browser tests; `image.yaml` builds the static `dist/` Docker image.

## Architecture

**Threads.** The main thread (`src/main.ts`, `src/ui/`, `src/render/navigation.ts`) owns the DOM, settings and camera. `RenderClient` (`src/render/client.ts`) sends at most one unacknowledged `state` message to the render worker (`src/render/worker.ts`), which owns WebGL through an OffscreenCanvas, the `HabitatRenderer`, and the weather client. The weather solver and the Mie-table pool run in their own workers. The worker reports every change of sample count, mode, image size or accumulation; the client mirrors it into `#scene` data attributes and dispatches a `renderstate` event on the canvas.

**One big shader.** `HabitatRenderer` (`src/render/renderer.ts`) concatenates GLSL files as raw strings in a fixed order (`common`, `landscape`, `surface`, `geometry`, `spectrum`, `cache`, `transport`, `atmosphere`); later files use earlier ones. `atmosphere.glsl`'s `main()` is one program with three modes chosen by uniforms: camera samples, cloud-cache iterations (`uCachePass`) and surface-atlas samples (`uSurfacePass`). They share the single `pathRadiance` call. Never add a second call site of a large function (`pathRadiance`, `traceInterior`, `shadowTransmission`, …): the compiler inlines each copy, which cost ~5 s of cold compile on a desktop GPU and made SwiftShader slow enough to time out CI. Use a loop with a runtime count instead (see the legs loop in `directLight`). Measure cold compile with an injected code change; comments are stripped and cached.

**Frame loop.** `render(interacting)` draws the raster `NavigationPreview` while the camera moves (and 200 ms after), otherwise path-traces in scissored bands behind a GPU fence so no submission is long. Only complete samples are displayed or accumulated. Accumulation is an exact running mean, bounded to a 1/32 weight while weather is live or a cache is warming. Cloud-cache iterations and surface-atlas samples are advanced in bands interleaved with camera bands; the atlas is paid from a budget of camera paths. Camera movement resets accumulation, not the caches; physical setting changes reset everything (`physicalState` in `apply`).

**Light transport (`transport.glsl`).** Spectral: four wavelengths per path (hero + 3 at +100 nm) with spectral MIS; delta/ratio tracking with per-cell majorants; forced single scattering of air on the camera segment. Next-event estimation samples the finite Sun through routes: direct through a window, via one mirror, or via one reflection off the inside of a pane (2D root of ρ·sin(2θ−δ) = R·sin θ, focusing R·cos θ/|R·cos θ − 2t|); paths that hit the Sun along these routes get the matching MIS weight (`paneRatio`/`paneWeight` in `PathState`). Sun hits after a scattering vertex that no route covers (two pane reflections, two mirrors) are omitted on purpose. `paneRouteSources` (`src/optics.ts`) culls the pane search on the CPU.

**Caches (approximations, validated against exact paths).**
- Cloud cache (`cache.ts`, `cache.glsl`, `cache-diffusion.glsl`): cylindrical grid of scattered fluence and flux (P1); camera paths follow two droplet scatterings exactly, then read it; optically deep cells are solved by diffusion.
- Surface light atlas (layout in `geometry.glsl`, 128×192 over the wall and both endcaps): irradiance of light scattered or reflected at least once, per reflectance band relative to sunlight (`SOLAR_BANDS` in `color.ts`). Filled by paths starting on the surfaces, which never read it. Camera paths skip roulette at their first surface and end at their second in the atlas (`uSurfaceCache`). The raster preview shows it plus an analytic direct-sun bake.

Tests or experiments that compare samples rendered at different times must set `renderer.material.uniforms.uSurfaceCache.value = false` (the atlas keeps refining) and report no cloud mass (cloud cache off). To validate transport changes, compare exact paths (cache off) with the cached estimator: block means and per-sample variance at real resolution on a GPU.

**Units and conventions.** Geometry is in kilometres; `EPS` is 5 cm. Camera output is CIE XYZ relative to `SOLAR_ILLUMINANCE`. Surface materials are spectra through 680/550/440 nm anchors (`materialSpectrum`). Leave glass along its normal, not the new direction (grazing steps re-hit the pane). Settings ranges and parsing of untrusted links/imports live in `src/ui/controls.ts`.

**Terrain.** The GPU bakes terrain height and land-cover atlases (`preview.ts`, `terrain.glsl`) from `groundHeight` in `common.glsl`. `src/terrain.ts` is a CPU port sampled like the GPU's bilinear atlas (used by the eye-level Ground view); keep the two in sync — a browser test compares them.

**Display.** `DisplayDenoiser` (SVGF-style à-trous, `denoise.glsl`) and the light meter are display-only; accumulation and readouts use raw values. `display.glsl` upsamples with clamped Catmull-Rom, then AgX tone mapping (`tonemap.glsl`) with optional adaptation (`vision.ts`).

## Tests

Unit tests (`tests/*.test.ts`, vitest, node) cover physics, optics, Mie, weather, colour, terrain and navigation. Browser tests (`tests/browser/*.spec.ts`) either drive the app or use `openIsolatedPage` to import modules and compile shaders directly. Wait for observable state, never time windows: `expect.timeout` is 0, the test timeout is only a hang guard, app flows use `untilRender`/`renderReport` (`tests/browser/canvas.ts`), and pixel checks read the worker's image via *Save image* (`savedPixels`). WebGL fences only signal between tasks, so in-page loops must yield (`requestAnimationFrame`/`setTimeout`) between `render()` calls.
