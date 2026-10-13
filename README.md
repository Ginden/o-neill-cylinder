# O’Neill Atmosphere Lab

A progressive spectral path tracer and coarse moist-convection experiment inside a rotating, sealed cylinder. Everything runs locally in the browser; there is no backend, CDN, or analytics.

![Valley view: path-traced farmland, woodland, river and a village inside the cylinder, refined at 256 samples](public/preview.png)

## Run

Requires Node.js 24+ and a modern browser with Web Workers, OffscreenCanvas, WebGL 2 and floating-point render targets (`EXT_color_buffer_float`).

```sh
npm ci
npm run dev
```

Open the printed local address (normally <http://127.0.0.1:5173/>). Dragging, flying, scrolling and viewpoint changes use a rasterized navigation preview; 200 ms after movement stops, the spectral path tracer resumes. **Denoise display** is enabled by default and filters only the displayed image: surface light is filtered with its reflectance divided out, so texture survives, and haze is filtered separately; depth, surface normals and material domains guide edge preservation. Disable it in Display to inspect raw sampling noise. The light meter always reads the unfiltered accumulation. Use **Fast** for a smaller ray budget; **Balanced** is the default, and **High** traces at up to native resolution. Traced pixels are capped at 196,608 / 1,048,576 / 4,194,304 respectively; a Catmull–Rom filter upsamples the traced image to the canvas, which retains its native navigation resolution. All three use the same transport model and the same land-use geometry; Fast bakes 2048-texel instead of 4096-texel ground atlases. Hold the camera still to accumulate paths. Moving the camera, changing optical settings, or resetting weather restarts accumulation; changing exposure, visual adaptation, or display denoising does not. Live weather retains a rolling radiance history with a 1/32 update weight after the first 32 samples, instead of discarding the image on every cloud update. This smooths evolving clouds over a few seconds and also makes the raw light meter a temporal average. Pausing preserves that estimate with its effective sample weight, then accumulates an ordinary mean toward the frozen field; it does not discard the image or rewind the wavelength sequence. The scene is then constant, while the raw luminance estimate can still change as sampling noise converges. Particle-size changes calculate new Mie tables on up to four CPU workers; navigation stays available while the tables are prepared. The filtered display is clean after roughly 32 samples in the default valley view. With a cold driver shader cache, compiling the path tracer takes 10–20 s on first load. Software rendering is slow. Rendering runs on an OffscreenCanvas worker. Refinement is divided into bands of at most 196,608 pixels (32,768 with clouds enabled), with a GPU fence limiting work to one pending band; complete samples alone are accumulated and displayed. Asynchronous readback keeps the light meter from blocking navigation. Actual hardware performance depends on viewport size, GPU and cloud optical depth.

```sh
npm run check          # strict lint, numerical tests, type checking, production build
npm run test:render    # focused cloud/filter shader regressions (a few seconds)
npm run test:browser   # full Playwright interactions, shader/pixel checks and screenshots
npm run preview       # serve the production build locally after npm run build
```

For browser tests, install Chromium with `npx playwright install chromium`, or point `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at an existing compatible Chromium executable. Headless checks use SwiftShader, so they verify rendering correctness rather than GPU performance. Screenshots and an exported settings file go into `test-results/`.

GitHub Actions runs these checks on pushes and pull requests. When testing against the development server, finish application edits before starting browser checks: hot reload replaces the interface and interrupts in-flight interactions.

## Rendering performance

The main thread handles controls and navigation. A dedicated worker owns WebGL, metering and the weather client; the weather solver runs in its own worker. A pool of one to four additional workers calculates independent wavelength rows of the Mie tables. The pool reuses unchanged particle populations and discards superseded slider jobs after their current four-row batch. Table arrays and weather snapshots transfer ownership between workers, while camera/settings messages are small and limited to one unacknowledged update. This does not require shared-memory synchronization or cross-origin isolation headers.

The GPU still does the spectral tracing. Small, fenced submissions let the browser composite the UI between bands. Completed weather snapshots are applied between whole samples. Their radiance history is retained while weather runs; the wavelength sequence keeps advancing independently of the capped temporal weight. Hidden tabs stop rendering and scheduling weather steps. PNG export is asynchronous from the worker canvas.

The initial worker migration (`ad24de2`) was measured with a local Chromium/RTX 5070 production-build comparison at a 1280 × 800 viewport, DPR 1, Balanced, default clear daylight (940 × 800 traced pixels, five-second observation after warm-up) measured:

| Measurement | Before | After |
| --- | ---: | ---: |
| Main-thread animation cadence during refinement | 30.5 FPS | 60.0 FPS |
| Longest animation gap during refinement | 66.8 ms | 16.8 ms |
| Complete spectral samples per second | 10.0 | 9.4 |
| Longest animation gap while changing cloud radius to 20 μm | 1,250 ms | 16.8 ms |

That migration kept the physical estimator and resolution unchanged. Smaller GPU submissions have some scheduling overhead: the paired production run traded about 6% of sample throughput for smoother interaction. Worker-build throughput varied between 8.2 and 9.8 samples/s across the development and production runs; UI cadence stayed at 60 FPS. Earlier Russian roulette now improves tracing throughput as well. A subsequent paired development-build run on the same GPU, viewport and ray dimensions measured **8.8 → 19.3 samples/s**, with 60.0 FPS UI cadence and a 16.8 ms maximum animation gap in both runs. GPU timer queries attributed roughly 84 ms/sample to tracing before, and 40 ms/sample after. Neither resolution nor scene geometry was reduced.

The tradeoff is higher variance per sample from the weak indirect paths that survive termination. At 128 × 96 pixels, two 2,624-sample renders (earlier versus original roulette) agreed within 0.3% in all XYZ channels across six image regions. Raw image mean-square error at 82 optimized samples was about 25% lower than at 41 original samples against the opposite estimator's long-run reference; the measured throughput gain exceeds that twofold sample-count increase. These checks cover the default clear-daylight view, not every cloud or lighting condition. Live cloud optical depth still affects performance, and temporal history deliberately smooths changing weather rather than claiming convergence to its instantaneous state.

To repeat the throughput measurement against a running development or preview server:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium-browser \
  BENCHMARK_GPU_ARGS='--use-angle=gl-egl --ignore-gpu-blocklist --enable-gpu' \
  node scripts/benchmark.mjs
```

Choose GPU flags appropriate to your platform; the output includes the actual GPU and ray dimensions. `BENCHMARK_URL` selects another server URL. SwiftShader browser tests check correctness and are not hardware performance measurements.

## Explore

- **Drag** the viewport to look; **scroll** to fly forward/backward.
- Click the viewport, then use **WASD** to fly, **Q/E** for local down/up, **arrows** to look, and **Shift** to move faster.
- **Ground**, **Overlook**, and **Axis** set camera viewpoints. The circular arrow recenters the selected view.
- **Habitat** adjusts dimensions, wall gravity, window coverage, terrain, pressure, temperature, and lapse rate.
- **Light** adjusts the actual Sun direction, finite mirror deployment and reflectivity, window absorption, and aerosol/cloud particle size.
- **Weather** adjusts initial humidity, surface heating, evaporation, wind, time acceleration, and random seed. Physical/source changes restart the weather; display changes do not.
- **Display** offers atmosphere on/off, quality, adaptive viewing, fixed exposure, and diagnostic layers.
- **Copy link** encodes experiment settings in the URL. **Export/Import experiment JSON** provides portable configuration files. These save initial conditions and the selected viewpoint, not evolved weather or an arbitrary free-flight camera pose.
- **Save image** exports the rendered canvas at its current resolution, without the interface.

For optical comparisons, disable **Adapt to scene brightness** and keep exposure fixed. Suggested comparisons: clear daylight against vacuum at fixed exposure; aerosol-free against hazy air; ground against axis views; small against giant cylinders; direct sunlight against reflected beams. The **Night** preset removes solar illumination. Adaptive viewing responds to the remaining illumination; fixed exposure holds the camera gain constant. Its emitting settlement patches have 2 cd/m² luminance and a 2800 K spectrum; scattered and reflected lamp light comes from traced paths. There is no artificial star field. Dark photographs are expected at fixed daytime exposure. Adaptive viewing is a display approximation, not a complete model of dark-adapted vision.

## Landscape

Each of the three land strips is its own valley: a meandering river with a flat floodplain, a road along one bank, and eroded hills (slope-damped, domain-warped fBm) that rise toward woodland ridges beside the windows. Arc length is measured from a window center, so no coordinate seam crosses land. Land use is procedural, in the character of late-summer European farmland: staggered, warped parcels split into strip fields of pasture, ripe and harvested cereals, green crops, mown hay, maize, ploughed soil and occasional rapeseed, with tramlines, mowing stripes, moisture patches, grass margins and farm tracks; hedgerows with gaps along some boundaries; riverbank trees; woodland on high ground; isolated field trees; and villages of gable-roofed houses, gardens and yards along the road.

Trees and houses are explicit geometry for camera, shadow and first-bounce rays, not textures. A GPU bake stores terrain height (32-bit float, about 6 m texels in the default habitat), a half-precision copy for standing objects, and land cover (tree probability, tree size, tree and building occupancy). Ellipsoidal crowns stand on jittered 8 m cells and houses on 30 m lots, each anchored at the terrain height of its own center. Averaged mip levels of the binary occupancy flags prove 24–48 m of empty land around a ray, so rays cross open fields without evaluating objects. Heightfield steps combine a terrain slope bound of 1.5 with the ray's climb rate, so rays leaving the ground take long steps, and rays toward a window step straight to the analytic hull. Against a brute-force march (0.4 m steps, 64,000 random near-ground rays) no intersections were missed; fewer than 1% of camera rays exhaust the 320-step budget at grazing incidence.

## Physics

All rendering distances are kilometres. The weather grid uses metres, seconds, kelvin, pascals, and kg/kg mixing ratios.

### Rotating atmosphere

The angular velocity is selected from the wall gravity:

\[
\Omega = \sqrt{g_R/R},\qquad g(r)=\Omega^2r.
\]

The centrifugal potential height above the wall is

\[
h(r)=\frac{R^2-r^2}{2R},\qquad T(r)=T_R-Lh(r).
\]

For a nonzero lapse rate, ideal-gas hydrostatic balance gives

\[
p(r)=p_R\left(\frac{T(r)}{T_R}\right)^{g_R/(R_aL)}.
\]

At zero lapse, the limiting expression is exponential. `backgroundAt()` implements both forms. A 4 km radius cylinder at 1g, with an isothermal 288 K atmosphere, retains about 79% of wall pressure at the axis. With the default 20 °C wall temperature and 6.5 K/km potential-height lapse, axis pressure is about 798 hPa.

### Spectral light transport

The renderer estimates the radiative-transfer equation by Monte Carlo path tracing. Each camera sample follows one path at four wavelengths (hero wavelength sampling): a hero stratified on 380–780 nm and three companions rotated by 100, 200 and 300 nm, so each is uniform on the band. The path follows scattering and reflection events and contributes spectral radiance at all four wavelengths to CIE XYZ. Linear XYZ is accumulated in two floating-point render targets. Only the display pass applies viewing adaptation, converts XYZ to a Rec. 2020 working space, applies the AgX display transform, converts to linear sRGB and encodes sRGB. No ambient brightness, diffuse cloud fill, or fabricated solar beam is added.

The Sun is a finite 0.533° disk at 1 au with a 5772 K Planck spectrum. Irradiance follows its radiance and solid angle. Three **explicit, finite rectangular mirrors** hinge at the −Z ends of the window bands. Each panel is √2 × cylinder length along its deployment direction and one window chord across. Deployment is 45° plus the selected offset. Rays must hit the reflecting face and miss intervening blockers. Specular reflection determines outgoing directions; changing Sun direction does not magically retarget the mirrors. Mirror reflectivity is a specified neutral material property. Exterior hull and mirror backs are absorbing black surfaces.

Sealed windows have 10 m structural rings at 1.5 km spacing and 10 m edge frames. The same apertures obstruct camera and illumination paths. Panes use BK7 Sellmeier dispersion and unpolarized Fresnel reflection, including both interfaces and repeated internal reflection in a thin parallel plate. Normal-incidence bulk transmission specifies absorption separately from Fresnel losses; longer oblique paths and every internal reflection include absorption. Terrain, trees and houses are intersected on secondary and shadow rays as well as camera rays (see Landscape). The heightfield is precomputed into a floating-point atlas of up to 4096 × 4096 texels; every physical ray uses the same bilinearly interpolated geometry. Shading uses smooth terrain normals from one-texel central differences, with metre-scale relief, and leaf-clump normals on crowns; the geometric normal offsets and bounds new rays, and shading-normal samples beneath the geometric surface are absorbed. Land sectors clip terrain solids with explicit exposed terrace sides and angular face normals at window boundaries.

Dry-air Rayleigh scattering uses a 550 nm coefficient of 0.013558 km⁻¹ at reference air density, wavelength dependence with Edlén refractive-index dispersion, and the normalized Rayleigh phase function. Aerosol and water-droplet extinction, absorption and scattering phase functions are calculated with the **Lorenz–Mie solution**, including the narrow forward diffraction peak. Both populations are lognormal with log width 0.35 and adjustable effective radius E[r³]/E[r²]. The assumed complex indices are 1.50 + 0.01i for aerosol and 1.333 + 10⁻⁹i for water; these are constant-index material assumptions rather than measured wavelength-dependent composition. Forty-one wavelength nodes at 10 nm spacing and 1024 angular nodes using θ = πu² resolve the lookup tables. Aerosol extinction is specified at 550 nm; cloud cross-sections are calculated per unit liquid-water mass.

Spectral coefficients and source radiance are prepared once per camera path. Cloud-free rays use the global clear-air majorant directly; cloudy rays traverse interpolation cells. Delta tracking samples medium collisions with the hero's probabilities. Companion wavelengths are weighted by their own collision probabilities and Mie phase functions, and the balance heuristic over the four wavelengths and over light and phase/BSDF sampling combines them (spectral multiple importance sampling, as in PBRT-v4). Thin parallel panes, reflecting water and neutral mirrors keep one direction for all wavelengths, so a path never falls back to a single wavelength. Over long droplet walks, the wavelength-dependent Mie phase functions shift weight toward one wavelength, so dense-cloud light converges more slowly in color than clear-air light. Against the previous single-wavelength estimator, 1024-sample renders of clear, hazy, axis-view, cloudy and night scenes agree within sampling error in every image region; at one sample per pixel, pixel chromaticity error in clear air is about 4.5× lower (Δu′v′ 0.26 → 0.06) and luminance error about half. Ratio tracking estimates light-path transmittance using interpolation-cell majorants that bound all eight cloud-density texels. Finite-disk next-event estimation and multiple importance sampling connect diffuse/volume vertices through actual windows and mirrors to the Sun. For each sampled solar direction, the analytic hull first decides which routes (direct, or by one of the three mirrors) can carry it to the vertex, and only open routes are chosen; terrain, objects, media and glass are tested afterwards, and a closed route contributes nothing. Every camera ray also estimates single scattering by air with one forced collision on its segment, sampled in proportion to majorant transmittance, with ratio-tracked transmittance. Analog air collisions on that segment omit single scattering (no next-event estimate, no direct solar hit) so it is not counted twice; segments after a pane reflection are not covered and keep it. Comparison renders at 1024 samples agree with the purely analog estimator to within 0.3% in every image region. Inside the habitat, rays meeting a pane choose reflection with probability 0.85 instead of the Fresnel reflectance and are reweighted: beyond the glass, space is black except along routes that next-event estimation already samples. Paths after their second scattering event ignore trees and houses; they carry a few percent of the radiance and would dominate the cost of marching crowns. A non-finite sample is recorded as zero rather than poisoning a pixel's history. Diffuse surface interreflection and multiple medium scattering come from continuing paths with Russian roulette. After the first scattering event, weak continuation paths can terminate after their direct-light estimate; survivors are weighted by the inverse survival probability. This preserves expected radiance while avoiding expensive, low-contribution secondary intersections.

The navigation preview rasterizes a cylinder mesh and endcaps with cached direct illumination. Its monochromatic direct-light cache omits terrain shadows, indirect light and volume scattering, and the mesh has no trees or houses (tree cover tints the ground instead); it is for orientation while moving, not optical measurement. Static refinement switches back to the physical renderer. The display filter (SVGF-style) accumulates two components: total radiance, and haze, the part from the forced single-scattering estimate and from paths whose first event is a collision in the medium on the camera ray. Surface light (total minus haze) is divided by the first-hit reflectance from the guide buffer, filtered, and multiplied back; water and panes are not demodulated. Haze is filtered on its own using the expected first-cloud-collision depth, with surviving rays reaching the surface; opaque fog therefore does not inherit hidden tree, roof or window-ring edges. This depth is a deterministic 550 nm visibility guide, updated with weather snapshots, used only for filtering. Surface albedo is never divided out of the additive atmospheric light: doing so imprints surface patterns onto haze. Five 3 × 3 edge-aware à-trous passes at strides 1–16 (seven passes, through stride 64, when condensate is present) use the variance of each pixel mean from luminance second moments (a 3 × 3 spatial estimate over the first four samples), conservatively propagated through the overlapping passes, whose samples are correlated. Luminance uses depth, normal, domain and variance-scaled luminance weights; chromaticity uses depth and domain only, because each sample carries only four wavelengths and luminance stopping would keep spectral color speckle. With clouds, demodulated illumination color is pooled across diffuse tree, terrain and building domains with the wider depth tolerance used for haze; uncertain diffuse luminance can also borrow neighboring illumination despite differing crown normals, with normal/material edge stopping restored as confidence grows. Panes and water keep their separate filtering domains. Dense clouds can still show grain and bright outliers at interactive sample counts; pause to refine a fixed field. Guides sample four pixel quadrants as well as the center. Thin window rings share the pane filtering domain. Both sides of a filter connection supply variance, and uncertain luminance differences receive weak edge stopping. This allows sparse spectral contributions to spread into zero-contribution pixels; thresholds tighten as samples accumulate. The filter can still soften unresolved detail or low-sample shadow boundaries. It does not change radiance accumulation or meter data.

### Viewing adaptation

**Adapt to scene brightness** is enabled by default. A 32 × 32 area meter samples the unfiltered HDR image asynchronously every eight completed samples. The geometric mean of positive luminances, trimmed at the 10th/90th percentiles, sets display exposure; empty space and small solar glints do not dominate the view. Exposure maps the metered scene luminance to approximately 18% display-linear middle gray, with a 0.01 cd/m² floor to bound amplification in darkness. The initial valid reading establishes adaptation, and subsequent changes approach it in log luminance with a 0.6 s brightening / 3 s darkening time constant. Camera changes and weather resets retain adaptation while invalidating stale meter readbacks.

The adaptive display uses Bradford adaptation from the simulated solar white to D65. Color is gradually reduced between 0.005 and 5 cd/m², using pixel luminance before exposure. Both navigation and refinement share the AgX display transform (log encoding and sigmoid in a Rec. 2020 working space, with Blender/Filament constants) and a mild contrast and saturation look. Highlights desaturate toward white as on film; neutrals stay neutral and zero radiance stays black. Navigation integrates the same spectral material basis under the Sun, rather than interpreting wavelength anchors as RGB colors.

These are explicit display approximations. They do not model rod spectral sensitivity, retinal local adaptation, glare, acuity loss, or the full time course of dark adaptation. A monitor cannot reproduce the scene’s physical luminance range. Optical depth and atmospheric contrast loss remain in the radiance; adaptation does not remove haze or create light in black pixels. Disable adaptation for fixed-exposure measurements and comparisons.


The **sightline luminance meter** reports the central 5 × 5 accumulated pixel average in cd/m² before exposure; it is unavailable on diagnostic layers and during navigation preview. This is photopic luminance for the specified scene and source, not a prediction of a person's recognition threshold. A shaded surface can receive substantial indirect daylight. The same object at night may be unrecognizable without illumination, irrespective of increased photographic exposure.

River surfaces use a dielectric GGX reflection model with slope parameter 0.045 and water index 1.333, including Fresnel reflection, Smith masking, solar next-event estimation and BSDF sampling with MIS. Transmitted energy is absorbed in deep water; shallow-water beds and water-volume scattering are not modeled.

**Scene assumptions and numerical limits:** interior surfaces have specified piecewise-linear diffuse reflectance spectra with 440/550/680 nm anchors, not measured habitat materials. Trees are diffuse ellipsoidal crowns (no trunks, leaves or foliage transmission) and houses are gable-roofed boxes; both are procedural stand-ins, not modeled or measured assets. Night emitting patches are a specified source distribution. The exterior contains the Sun, hull and panels, with no planet, moon or stellar catalog. The source spectrum does not include measured solar absorption lines or limb darkening. No polarization, atmospheric refraction, nonspherical aerosol optics, measured bidirectional surface reflectance, or finite glass thickness is resolved. Cloud-enabled paths allow up to 1024 events (64 without clouds), and droplet paths use throughput-based roulette without a mandatory 5% termination at every scattering; geometry and medium segments have 320-step and 2048-proposal budgets. These limits, table interpolation, 15 particle-size quadrature bins, noisy finite samples, and procedural geometry require convergence/reference validation before making quantitative habitat predictions. The weather density field remains coarse.

### Moist convection

`WeatherSolver` runs in a Web Worker on a 24 × 24 × 48 Cartesian grid masked to the cylinder. It evolves velocity, temperature anomaly, vapor, and cloud liquid using:

- Semi-Lagrangian transport with trilinear sampling.
- A collocated pressure projection with 24 Jacobi iterations and approximate impermeable boundaries.
- Radially varying centrifugal buoyancy, including vapor and liquid-water loading.
- Exact rotation of horizontal velocity for the Coriolis term.
- Dry-adiabatic cooling relative to the prescribed background lapse.
- Illumination-dependent surface-layer heating, evaporation, and damping.
- Iterative saturation adjustment conserving parcel water and `cp × T + Lv × vapor`.
- CFL and rotation-based timestep limits.

The initial vapor mixing ratio is approximately uniform, based on wall relative humidity. Cooler central air can therefore condense immediately. In the **Humid afternoon** preset, a central cloud/fog region is an expected consequence of these initial assumptions. It is not an artist-authored cloud layer. The default **Clear daylight** preset exposes the unobscured habitat; enable clouds in Weather to run the moist model.

**Limits:** this is a coarse Boussinesq experiment with a prescribed background, not a validated climate model. Semi-Lagrangian advection is diffusive and does not conserve global water exactly. Surface heat and vapor sources are grid-layer tendencies, not a resolved surface energy budget. There is no precipitation, ice, droplet spectrum, radiative feedback, or resolved boundary layer. Large cylinders and extreme parameters exceed the model’s useful approximation regime. The UI’s time counter reports actual integrated model time; compute limits may make the selected acceleration unattainable.

## Diagnostics

| Layer | Meaning |
| --- | --- |
| Natural light | Accumulated spectral light paths, displayed with adaptive or fixed exposure |
| RGB transmittance | Unscattered transmission at 680, 550 and 440 nm, including particles |
| Air column | Integrated reference-density air along the view ray; blue-to-gold visualization |
| Liquid-water column | Integrated cloud liquid; dark-to-mint visualization |

The central **clear-air sightline** readout uses the sealed-cylinder intersection and reports blue transmittance from molecules and aerosols. It excludes clouds and terrain relief. Axis pressure and rotation period come from the physical background model.

## Code map

| File/directory | Responsibility |
| --- | --- |
| `src/settings.ts` | Parameters and presets |
| `src/physics.ts` | Hydrostatics, thermodynamics, window/light geometry |
| `src/weather/` | Moist solver, worker transport, client scheduling |
| `src/render/shaders/` | Spectral path tracing, explicit geometry, Fresnel glass and display conversion |
| `src/render/shaders/landscape.glsl`, `surface.glsl` | Terrain, land use, tree and house geometry, materials |
| `src/render/preview.ts` | Navigation raster preview; terrain and land-cover atlas bakes |
| `src/render/mie.ts`, `solar.ts`, `majorant.ts` | Particle cross-sections/phase tables, source calibration and medium bounds |
| `src/optics.ts` | Explicit mirror dimensions, reflection geometry and CPU window visibility |
| `src/render/vision.ts`, `color.ts`, `postprocess.ts` | Display adaptation, spectral preview colors, filtering and metering |
| `src/render/client.ts`, `worker.ts`, `protocol.ts` | OffscreenCanvas ownership, bounded input updates, render scheduling and PNG export |
| `src/render/particles.ts`, `particles.worker.ts` | Parallel Mie table generation and cancellation |
| `src/render/renderer.ts`, `navigation.ts` | GPU band accumulation, 3D texture uploads, local-up navigation |
| `src/ui/` | Parameter controls, imported settings validation, model notes |
| `tests/` | Numerical physics/regression checks and browser rendering checks |

The renderer uses WebGL 2 for broad compatibility and straightforward custom GLSL. A future WebGPU backend could move weather updates to compute shaders. Next validation work would compare converged scenes against PBRT or another independent spectral renderer, measure convergence under dense clouds and extreme grazing rays, and replace assumed optical materials with measured spectra. A conservative/anelastic fluid solver is a separate climate-model improvement.

## References

- [Ferwerda et al.: A Model of Visual Adaptation for Realistic Image Synthesis](https://www.graphics.cornell.edu/pubs/1996/FPSG96.pdf) — motivation and scope of perceptual rendering; the display here is a simpler approximation.
- [Reinhard et al.: Photographic Tone Reproduction for Digital Images](https://www-old.cs.utah.edu/docs/techreports/2002/pdf/UUCS-02-001.pdf) — log-average metering and middle-gray exposure.

- [PBRT 4: volumetric path tracing](https://www.pbr-book.org/4ed/Light_Transport_II_Volume_Rendering/Volume_Scattering_Integrators) and [dielectric optics](https://www.pbr-book.org/4ed/Reflection_Models/Dielectric_BSDF).
- [Prahl: Mie scattering algorithms and Wiscombe reference cases](https://miepython.readthedocs.io/en/stable/07_algorithm.html).
- [Wyman, Sloan & Shirley: CIE XYZ matching-function fits](https://jcgt.org/published/0002/02/01/).
- [SCHOTT N-BK7 optical-glass data](https://media.schott.com/api/public/content/41e799d0bf874807a0bb8e702fbb75b5?v=54856406) and [NIST air-index documentation](https://emtoolbox.nist.gov/wavelength/documentation.asp).

- [Bruneton & Neyret: Precomputed Atmospheric Scattering](https://ebruneton.github.io/precomputed_atmospheric_scattering/) — scattering physics and reference implementation; its spherical precomputed tables are not reused here.
- [NASA Planetary Spectrum Generator: atmospheric radiative transfer](https://psg.gsfc.nasa.gov/helpatm.php).
- [NCAR Community Atmosphere Model description](https://www.cesm.ucar.edu/models/atm-cam/docs/description/description.pdf) — atmospheric thermodynamics and condensate modeling context; this project is a much simpler model.

Blender is optional for future geometry or reference renders. No running Blender MCP server is required by this project.
