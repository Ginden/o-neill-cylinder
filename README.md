# O’Neill Atmosphere Lab

An interactive Three.js experiment in atmospheric optics and coarse moist convection inside a rotating, sealed cylinder. Everything runs locally in the browser; there is no backend, CDN, or analytics.

![Clear-air ground view of the cylinder and experiment controls](public/preview.png)

## Run

Requires Node.js 24+ and a browser with WebGL 2.

```sh
npm ci
npm run dev
```

Open the printed local address (normally <http://127.0.0.1:5173/>). Use **Fast** render quality on slower hardware. **Balanced** is the default; **High** increases both resolution and view-ray samples. GPU performance has not been measured on physical graphics hardware in the development environment.

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
- **Light** adjusts idealized reflected beams or direct sunlight, window transmission, aerosols, and scattering anisotropy.
- **Weather** adjusts initial humidity, surface heating, evaporation, wind, time acceleration, and random seed. Physical/source changes restart the weather; display changes do not.
- **Display** offers atmosphere on/off, quality, fixed exposure, and diagnostic layers.
- **Copy link** encodes experiment settings in the URL. **Export/Import experiment JSON** provides portable configuration files. These save initial conditions and the selected viewpoint, not evolved weather or an arbitrary free-flight camera pose.
- **Save image** exports the rendered canvas at its current resolution, without the interface.

Suggested comparisons: clear daylight against vacuum at fixed exposure; aerosol-free against hazy air; ground against axis views; small against giant cylinders; direct sunlight against reflected beams. A **Night** preset removes solar illumination and shows faint stars and settlement lights.

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

### Light transport

A custom GLSL 3 shader traces a cylindrical terrain heightfield and integrates the radiative-transfer equation along each view ray. It includes:

- RGB Rayleigh coefficients `[0.005802, 0.013558, 0.0331]` km⁻¹ at 1013.25 hPa and 288.15 K, scaled by molecular number density.
- Conservative aerosol scattering with a Henyey–Greenstein phase function and adjustable asymmetry.
- Beer–Lambert attenuation of background and incident sunlight.
- Light-path intersection with transmitting window bands or opaque land/endcaps.
- Cloud liquid-water extinction with a 10 μm assumed effective droplet radius, approximately 150 m²/kg, and a forward-scattering phase function.
- Fixed exposure, ACES tone mapping, and a single final sRGB encoding.

Mirror mode supplies three idealized directional reflected beams. Direct mode supplies one beam. The source RGB values are normalized irradiance units; this is not an absolute photometric instrument. Windows have scalar transmission, without Fresnel reflection or glass absorption spectra.

**Approximations:** single scattering in clear air, four midpoint samples for sunlight attenuation, approximate diffuse multiple-scattering fill in clouds, and a small approximate surface-bounce term. Terrain relief does not cast shadows along sunlight paths. The reference hydrostatic air density is used for molecular scattering; weather temperature anomalies do not modify that part of the renderer. Thin cloud shadows can be missed. No polarization, fully spectral integration, or detailed external mirror geometry.

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
| Natural light | Attenuated surfaces/windows plus scattered light, with fixed exposure |
| RGB transmittance | Fraction of background light reaching the camera, including cloud extinction |
| Air column | Integrated reference-density air along the view ray; blue-to-gold visualization |
| Liquid-water column | Integrated cloud liquid; dark-to-mint visualization |

The central **clear-air sightline** readout uses the sealed-cylinder intersection and reports blue transmittance from molecules and aerosols. It excludes clouds and terrain relief. Axis pressure and rotation period come from the physical background model.

## Code map

| File/directory | Responsibility |
| --- | --- |
| `src/settings.ts` | Parameters and presets |
| `src/physics.ts` | Hydrostatics, thermodynamics, window/light geometry |
| `src/weather/` | Moist solver, worker transport, client scheduling |
| `src/render/shaders/` | Window/terrain intersections and volumetric transport |
| `src/render/` | Three.js setup, 3D texture uploads, local-up navigation |
| `src/ui/` | Parameter controls, imported settings validation, model notes |
| `tests/` | Numerical physics/regression checks and browser rendering checks |

The renderer uses WebGL 2 for broad compatibility and straightforward custom GLSL. A future WebGPU backend could move weather updates to compute shaders. Higher priority scientific improvements would be a conservative/anelastic fluid solver, converged light-path integration, and a reference Monte Carlo renderer for validating multiple scattering. The procedural star field is illustrative rather than catalog-calibrated; the Night preset increases exposure by many stops instead of making stars as bright as daylight.

## References

- [Bruneton & Neyret: Precomputed Atmospheric Scattering](https://ebruneton.github.io/precomputed_atmospheric_scattering/) — scattering physics and reference implementation; its spherical precomputed tables are not reused here.
- [NASA Planetary Spectrum Generator: atmospheric radiative transfer](https://psg.gsfc.nasa.gov/helpatm.php).
- [NCAR Community Atmosphere Model description](https://www.cesm.ucar.edu/models/atm-cam/docs/description/description.pdf) — atmospheric thermodynamics and condensate modeling context; this project is a much simpler model.

Blender is optional for future geometry or reference renders. No running Blender MCP server is required by this project.
