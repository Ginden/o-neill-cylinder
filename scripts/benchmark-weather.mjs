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
    const stepMs = [], cacheMs = [], projectionMs = [], condensationMs = [], advectionMs = [], pressureProducts = [];
    for (let trial = 0; trial < 3; trial++) {
      const solver = new WeatherSolver(settings);
      for (let i = 0; i < 12; i++) solver.step(4);
      const profile = { project: 0, condense: 0, advect: 0, products: 0 };
      for (const name of ['project', 'condense', 'advect']) {
        const call = solver[name].bind(solver);
        solver[name] = (...args) => { const start = performance.now(); const value = call(...args); profile[name] += performance.now() - start; return value; };
      }
      const product = solver.pressureProduct.bind(solver);
      solver.pressureProduct = (...args) => { profile.products++; return product(...args); };
      let start = performance.now();
      for (let i = 0; i < 32; i++) solver.step(4);
      stepMs.push((performance.now()-start)/32);
      projectionMs.push(profile.project/32);condensationMs.push(profile.condense/32);advectionMs.push(profile.advect/32);pressureProducts.push(profile.products/32);
      const field = solver.snapshot();
      for (let i = 0; i < 6; i++) diffusionCells(field, settings, populations);
      start = performance.now();
      for (let i = 0; i < 20; i++) diffusionCells(field, settings, populations);
      cacheMs.push((performance.now()-start)/20);
    }
    scenes.push({ humidity, stepMs:median(stepMs), cacheRefreshMs:median(cacheMs), projectionMs:median(projectionMs), condensationMs:median(condensationMs), advectionMs:median(advectionMs), pressureProducts:median(pressureProducts), trials:{ stepMs, cacheMs } });
  }
  const duration = Number(process.env.BENCHMARK_DURATION ?? 0), longRuns = [];
  const rotationLimits=(process.env.BENCHMARK_ROTATIONS ?? '0.3,0.5,1').split(',').map(Number);
  if (duration > 0) for (const scene of [
    { label:'dry', humidity:45 }, { label:'humid', humidity:78 },
    { label:'small', humidity:78, radius:1, length:8 }, { label:'giant', humidity:78, radius:12, length:60 }
  ]) for (const rotationLimit of rotationLimits) {
    const settings = {...defaults,clouds:true,...scene}, solver = new WeatherSolver(settings);
    const checkpoints = [];
    let nextCheckpoint = duration/6, peakWind = 0, peakDivergence = 0, steps = 0;
    const start = performance.now();
    while (solver.seconds < duration-1e-6) {
      solver.step(nextCheckpoint-solver.seconds,rotationLimit);
      steps++;
      if (solver.seconds >= nextCheckpoint-1e-6) {
        const stats = solver.snapshot().stats, divergence = solver.divergenceRms();
        peakWind = Math.max(peakWind,stats.maxWind);peakDivergence = Math.max(peakDivergence,divergence);
        checkpoints.push({seconds:solver.seconds,cloudMass:stats.cloudMass,maxWind:stats.maxWind,divergence});
        nextCheckpoint = Math.min(duration,nextCheckpoint+duration/6);
      }
    }
    longRuns.push({scene:scene.label,rotationLimit,steps,computeSpeed:duration/((performance.now()-start)/1000),peakWind,peakDivergence,checkpoints});
  }
  console.log(JSON.stringify({ longRuns, node:process.version, cpu:cpus()[0].model, source, scenes }, null, 2));
} finally {
  rmSync(compiled, { recursive:true, force:true });
}
