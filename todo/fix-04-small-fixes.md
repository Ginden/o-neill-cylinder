# fix-04 — Small fixes

**Kind:** correctness and documentation · **Size:** small each

Each item was checked against the code; none needs the others.

## 1. `VITE_BASE_PATH` does nothing

`Dockerfile:8-9` declares the build argument and exports it, but
`vite.config.ts` sets no `base` and Vite does not read that variable by
itself. An image built with `--build-arg VITE_BASE_PATH=/lab/` still
references `/assets/…` from the root.

Fix: `base: process.env.VITE_BASE_PATH ?? '/'` in `vite.config.ts`, or drop
the argument. `index.html` links `/favicon.svg` and `/favicon.png` from the
root; check that they follow `base` in the built page.

## 2. The image workflow passes build arguments the Dockerfile never declares

`.github/workflows/image.yaml:65-69` passes `OCI_CREATED`, `OCI_SOURCE`,
`OCI_REVISION` and `OCI_VERSION`. The `Dockerfile` has no matching `ARG`, so
they are ignored (BuildKit warns). The labels come from the metadata step
anyway; remove the arguments, or declare them and use them.

## 3. Exposure is not measured until the eighth sample

`renderer.ts:501-502` meters when `(samples + 1) % 8 === 0`. Until the first
measurement the adaptation assumes 1000 cd/m² (`vision.ts:26`). A page that
opens on the *Night* preset (2 cd/m² lamps) is black for eight samples: one
second here, several in cloudy scenes or on a slower GPU.

Fix: also meter the first complete sample after the adaptation has never
been measured, or after each reset of accumulation.

## 4. Atlas texels are not "roughly square" for long, thin habitats

`atlasSize` (`terrain.ts:12-15`) fixes the width at the limit and shrinks
only the height. When the length exceeds the circumference, the height
saturates and the width stays 4096: at radius 0.5 km and length 80 km the
texels are 0.77 m around by 19.5 m along. The comment promises roughly
square texels.

Fix: shrink the width by `2πR / length` in that case (multiples of 32, as
the occupancy mips require). `terrainAtlasSize` is the only source of the
size, for the GPU bake and for the CPU port alike. `tests/atlas.test.ts`
covers this function, but checks square texels for the default habitat only.

## 5. The weather texture uploads four channels and reads one

Shaders read only `.r` of `uWeather` (liquid water): `transport.glsl:86`,
`:187`, `atmosphere.glsl:172-174`, `guides.glsl:17`. The snapshot carries
temperature anomaly, vapour and density too, and all four go to the GPU on
every snapshot as RGBA32F (`renderer.ts:206-217`). `cloudMajorants` and
`liquidAt` also step through the array in fours.

Fix: send liquid water alone as a one-channel texture. It is a quarter of
the upload and of the transfer between workers; small either way
(442 kB per snapshot now).

## 6. Documentation that has drifted

- README, *Quick start*: "expect 10–20 s with a cold driver cache". Measured
  26.5 s on an RTX 5070 (perf-03).
- README, *Accuracy*: the surface cache works "at 1.5× the cost". Measured
  1.8× for the camera pass (83.7 ms against 46.7 ms) and 1.9× with the
  atlas's own samples.
- `AGENTS.md`: "Never add a second call site of a large function
  (`pathRadiance`, `traceInterior`, `shadowTransmission`, …)". The tracer has
  three call sites of `traceInterior` and two of `shadowTransmission`
  (perf-03 lists them). Either fix the code or state the rule as it is
  applied.
- README, *Weather*: nothing says that *Simulation speed* is an upper bound
  (perf-07).
