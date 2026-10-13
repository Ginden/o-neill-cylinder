# O’Neill Atmosphere Lab

A progressive spectral path tracer and coarse moist-convection experiment inside a rotating, sealed cylinder. Everything runs locally in the browser; there is no backend, CDN, or analytics.

![Clear-air ground view of the cylinder and experiment controls](public/preview.png)

## Run

Requires Node.js 24+ and a browser with WebGL 2 and floating-point render targets (`EXT_color_buffer_float`).

```sh
npm ci
npm run dev
```

Open the printed local address (normally <http://127.0.0.1:5173/>). Dragging, flying, scrolling and viewpoint changes use a rasterized navigation preview; 200 ms after movement stops, the spectral path tracer resumes. **Denoise display** is enabled by default and filters only the displayed image, with depth, surface normals and material colors guiding edge preservation. Disable it in Display to inspect raw sampling noise. The light meter always reads the unfiltered accumulation. Use **Fast** for a smaller ray budget; **Balanced** is the default, and **High** increases detail. Traced pixels are capped at 98,304 / 262,144 / 786,432 respectively while the canvas retains its native navigation resolution. All three use the same transport model. Hold the camera still to accumulate paths. Moving the camera, changing optical settings, or receiving a new cloud field restarts accumulation; changing exposure or display denoising does not. Particle-size changes calculate new Mie tables and may briefly take time. GPU performance has not been measured on physical graphics hardware in the development environment. Software rendering is slow. A GPU fence limits expensive refinement to one pending pass, and asynchronous readback keeps the light meter from blocking navigation. Actual hardware performance depends on viewport size, GPU and cloud optical depth.

```sh
npm run check          # strict lint, numerical tests, type checking, production build
npm run test:browser   # Playwright interactions, shader/pixel checks and screenshots
npm run preview       # serve the production build locally after npm run build
```

For browser tests, install Chromium with `npx playwright install chromium`, or point `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at an existing compatible Chromium executable. Headless checks use SwiftShader, so they verify rendering correctness rather than GPU performance. Screenshots and an exported settings file go into `test-results/`.

GitHub Actions runs these checks on pushes and pull requests. When testing against the development server, finish application edits before starting browser checks: hot reload replaces the interface and interrupts in-flight interactions.

## Explore

- **Drag** the viewport to look; **scroll** to fly forward/backward.
- Click the viewport, then use **WASD** to fly, **Q/E** for local down/up, **arrows** to look, and **Shift** to move faster.
- **Ground**, **Overlook**, and **Axis** set camera viewpoints. The circular arrow recenters the selected view.
- **Habitat** adjusts dimensions, wall gravity, window coverage, terrain, pressure, temperature, and lapse rate.
- **Light** adjusts the actual Sun direction, finite mirror deployment and reflectivity, window absorption, and aerosol/cloud particle size.
- **Weather** adjusts initial humidity, surface heating, evaporation, wind, time acceleration, and random seed. Physical/source changes restart the weather; display changes do not.
- **Display** offers atmosphere on/off, quality, fixed exposure, and diagnostic layers.
- **Copy link** encodes experiment settings in the URL. **Export/Import experiment JSON** provides portable configuration files. These save initial conditions and the selected viewpoint, not evolved weather or an arbitrary free-flight camera pose.
- **Save image** exports the rendered canvas at its current resolution, without the interface.

Suggested comparisons: clear daylight against vacuum at fixed exposure; aerosol-free against hazy air; ground against axis views; small against giant cylinders; direct sunlight against reflected beams. The **Night** preset removes solar illumination while keeping the same exposure. Its emitting settlement patches have 2 cd/m² luminance and a 2800 K spectrum; scattered and reflected lamp light comes from traced paths. There is no artificial star field. Dark photographs are expected at daytime exposure. Exposure does not simulate dark-adapted vision.

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

The renderer estimates the radiative-transfer equation by Monte Carlo path tracing. Each camera sample selects a wavelength uniformly on 380–780 nm, follows scattering and reflection events, and contributes spectral radiance to CIE XYZ. Linear XYZ is accumulated in two floating-point render targets. Only the display pass converts to linear sRGB, applies exposure/ACES, and encodes sRGB. No ambient brightness, diffuse cloud fill, or fabricated solar beam is added.

The Sun is a finite 0.533° disk at 1 au with a 5772 K Planck spectrum. Irradiance follows its radiance and solid angle. Three **explicit, finite rectangular mirrors** hinge at the −Z ends of the window bands. Each panel is √2 × cylinder length along its deployment direction and one window chord across. Deployment is 45° plus the selected offset. Rays must hit the reflecting face and miss intervening blockers. Specular reflection determines outgoing directions; changing Sun direction does not magically retarget the mirrors. Mirror reflectivity is a specified neutral material property. Exterior hull and mirror backs are absorbing black surfaces.

Sealed windows have 10 m structural rings at 1.5 km spacing and 10 m edge frames. The same apertures obstruct camera and illumination paths. Panes use BK7 Sellmeier dispersion and unpolarized Fresnel reflection, including both interfaces and repeated internal reflection in a thin parallel plate. Normal-incidence bulk transmission specifies absorption separately from Fresnel losses; longer oblique paths and every internal reflection include absorption. Terrain is intersected on secondary and shadow rays as well as camera rays. Its heightfield is precomputed into a 2048 × 1024 floating-point atlas; every physical ray uses the same bilinearly interpolated geometry. Land sectors clip terrain solids with explicit exposed terrace sides and angular face normals at window boundaries.

Dry-air Rayleigh scattering uses a 550 nm coefficient of 0.013558 km⁻¹ at reference air density, wavelength dependence with Edlén refractive-index dispersion, and the normalized Rayleigh phase function. Aerosol and water-droplet extinction, absorption and scattering phase functions are calculated with the **Lorenz–Mie solution**, including the narrow forward diffraction peak. Both populations are lognormal with log width 0.35 and adjustable effective radius E[r³]/E[r²]. The assumed complex indices are 1.50 + 0.01i for aerosol and 1.333 + 10⁻⁹i for water; these are constant-index material assumptions rather than measured wavelength-dependent composition. Forty-one wavelength nodes at 10 nm spacing and 1024 angular nodes using θ = πu² resolve the lookup tables. Aerosol extinction is specified at 550 nm; cloud cross-sections are calculated per unit liquid-water mass.

Spectral coefficients and source radiance are prepared once per camera path. Cloud-free rays use the global clear-air majorant directly; cloudy rays traverse interpolation cells. Analog delta tracking samples medium collisions. Ratio tracking estimates light-path transmittance using interpolation-cell majorants that bound all eight cloud-density texels. Finite-disk next-event estimation and multiple importance sampling connect diffuse/volume vertices through actual windows and mirrors to the Sun. Diffuse surface interreflection and multiple medium scattering come from continuing paths with Russian roulette.

The navigation preview rasterizes a cylinder mesh and endcaps with cached direct illumination. Its monochromatic direct-light cache omits terrain shadows, indirect light and volume scattering; it is for orientation while moving, not optical measurement. Static refinement switches back to the physical renderer. The display filter estimates sampling variance from accumulated spectral second moments and uses four 3 × 3 edge-aware à-trous passes at strides 1, 2, 4 and 8. Diffuse colors are demodulated while filtering and restored afterward to preserve terrain markings. Guides sample four pixel quadrants as well as the center. Thin window rings share the pane filtering domain; mixed-material footprints retain total radiance and use consistent units when filtering across their neighbors. The filter can soften unresolved detail or low-sample shadow boundaries. It does not change radiance accumulation or meter data.

The **sightline luminance meter** reports the central 5 × 5 accumulated pixel average in cd/m² before exposure; it is unavailable on diagnostic layers and during navigation preview. This is photopic luminance for the specified scene and source, not a prediction of a person's recognition threshold. A shaded surface can receive substantial indirect daylight. The same object at night may be unrecognizable without illumination, irrespective of increased photographic exposure.

**Scene assumptions and numerical limits:** interior surfaces have specified piecewise-linear diffuse reflectance spectra with 440/550/680 nm anchors, not measured habitat materials. Procedural settlement roofs are reflectance patterns, not resolved building meshes; night emitting patches are a specified source distribution. The exterior contains the Sun, hull and panels, with no planet, moon or stellar catalog. The source spectrum does not include measured solar absorption lines or limb darkening. No polarization, atmospheric refraction, nonspherical aerosol optics, measured bidirectional surface reflectance, or finite glass thickness is resolved. Paths stop at 64 events; geometry and medium segments have 256-step and 2048-proposal budgets. These limits, table interpolation, 15 particle-size quadrature bins, noisy finite samples, and procedural geometry require convergence/reference validation before making quantitative habitat predictions. The weather density field remains coarse.

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
| Natural light | Accumulated spectral light paths, displayed with fixed camera exposure |
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
| `src/render/mie.ts`, `solar.ts`, `majorant.ts` | Particle cross-sections/phase tables, source calibration and medium bounds |
| `src/optics.ts` | Explicit mirror dimensions, reflection geometry and CPU window visibility |
| `src/render/` | Three.js setup, 3D texture uploads, local-up navigation |
| `src/ui/` | Parameter controls, imported settings validation, model notes |
| `tests/` | Numerical physics/regression checks and browser rendering checks |

The renderer uses WebGL 2 for broad compatibility and straightforward custom GLSL. A future WebGPU backend could move weather updates to compute shaders. Next validation work would compare converged scenes against PBRT or another independent spectral renderer, measure convergence under dense clouds and extreme grazing rays, and replace assumed optical materials with measured spectra. A conservative/anelastic fluid solver is a separate climate-model improvement.

## References

- [PBRT 4: volumetric path tracing](https://www.pbr-book.org/4ed/Light_Transport_II_Volume_Rendering/Volume_Scattering_Integrators) and [dielectric optics](https://www.pbr-book.org/4ed/Reflection_Models/Dielectric_BSDF).
- [Prahl: Mie scattering algorithms and Wiscombe reference cases](https://miepython.readthedocs.io/en/stable/07_algorithm.html).
- [Wyman, Sloan & Shirley: CIE XYZ matching-function fits](https://jcgt.org/published/0002/02/01/).
- [SCHOTT N-BK7 optical-glass data](https://media.schott.com/api/public/content/41e799d0bf874807a0bb8e702fbb75b5?v=54856406) and [NIST air-index documentation](https://emtoolbox.nist.gov/wavelength/documentation.asp).

- [Bruneton & Neyret: Precomputed Atmospheric Scattering](https://ebruneton.github.io/precomputed_atmospheric_scattering/) — scattering physics and reference implementation; its spherical precomputed tables are not reused here.
- [NASA Planetary Spectrum Generator: atmospheric radiative transfer](https://psg.gsfc.nasa.gov/helpatm.php).
- [NCAR Community Atmosphere Model description](https://www.cesm.ucar.edu/models/atm-cam/docs/description/description.pdf) — atmospheric thermodynamics and condensate modeling context; this project is a much simpler model.

Blender is optional for future geometry or reference renders. No running Blender MCP server is required by this project.
