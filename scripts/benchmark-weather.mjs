/* global console, URL */
// CPU work only: no renderer, GPU contention or shader compilation in these timings.
// BENCHMARK_SOURCE can point to another checkout for a before/after comparison.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(process.env.BENCHMARK_SOURCE ?? root);
const compiled = mkdtempSync(join(tmpdir(), 'oneill-weather-bench-'));
try {
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'),
    '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node', '--skipLibCheck',
    '--rootDir', join(source, 'src'), '--outDir', compiled,
    ...['weather/solver.ts', 'settings.ts', 'render/cache.ts'].map(file => join(source, 'src', file))
  ], { cwd: root, stdio: 'inherit' });
  const { WeatherSolver } = require(join(compiled, 'weather/solver.js'));
  const { defaults } = require(join(compiled, 'settings.js'));
  const { diffusionCells } = require(join(compiled, 'render/cache.js'));
  const { particleOptics } = require(join(compiled, 'render/mie.js'));
  const populations = [particleOptics(defaults.aerosolRadius, 0.35, [1.5, 0.01]), particleOptics(defaults.cloudRadius, 0.35, [1.333, 1e-9])];
  const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)];
  const scenes = [];
  for (const humidity of [45, 78]) {
    const settings = { ...defaults, clouds:true, humidity };
    const stepMs = [], cacheMs = [];
    for (let trial = 0; trial < 3; trial++) {
      const solver = new WeatherSolver(settings);
      for (let i = 0; i < 12; i++) solver.step(4);
      let start = performance.now();
      for (let i = 0; i < 32; i++) solver.step(4);
      stepMs.push((performance.now()-start)/32);
      const field = solver.snapshot();
      for (let i = 0; i < 6; i++) diffusionCells(field, settings, populations);
      start = performance.now();
      for (let i = 0; i < 20; i++) diffusionCells(field, settings, populations);
      cacheMs.push((performance.now()-start)/20);
    }
    scenes.push({ humidity, stepMs:median(stepMs), cacheRefreshMs:median(cacheMs), trials:{ stepMs, cacheMs } });
  }
  console.log(JSON.stringify({ node:process.version, cpu:cpus()[0].model, source, scenes }, null, 2));
} finally {
  rmSync(compiled, { recursive:true, force:true });
}
