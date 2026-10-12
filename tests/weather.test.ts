import { describe, expect, it } from 'vitest';
import { defaults } from '../src/settings';
import { WeatherSolver } from '../src/weather/solver';

describe('moist convection solver', () => {
  it('leaves a dry, unheated, motionless habitat free of clouds', () => {
    const solver = new WeatherSolver({ ...defaults, humidity:0, evaporation:0, surfaceHeating:0, wind:0 });
    for (let i = 0; i < 5; i++) solver.step(4);
    expect(solver.snapshot().stats.cloudMass).toBe(0);
    expect(Math.max(...solver.vapor)).toBe(0);
    expect(solver.snapshot().stats.maxWind).toBeLessThan(0.2);
  });
  it('condenses mixed vapor in cool central air without a procedural cloud mask', () => {
    const solver = new WeatherSolver({ ...defaults,humidity:78,clouds:true });
    const initial = solver.snapshot();
    expect(initial.stats.cloudMass).toBeGreaterThan(1e6);
    expect(initial.stats.cloudFraction).toBeGreaterThan(0.1);
    for (let i = 0; i < 6; i++) solver.step(4);
    const evolved = solver.snapshot();
    expect(evolved.stats.seconds).toBeGreaterThan(10);
    expect(evolved.stats.cloudMass).not.toBeCloseTo(initial.stats.cloudMass, -3);
    expect(evolved.stats.maxWind).toBeGreaterThan(0.1);
    expect(Array.from(evolved.data).every(Number.isFinite)).toBe(true);
  });
  it('reduces divergence when projecting an arbitrary velocity field', () => {
    const solver = new WeatherSolver({ ...defaults,wind:0,humidity:0 });
    for (let i = 0; i < solver.count; i++) {
      if (!solver.active[i]) continue;
      const x = i%solver.nx;
      const y = Math.floor(i/solver.nx)%solver.ny;
      const z = Math.floor(i/(solver.nx*solver.ny));
      solver.u[i] = Math.sin(x*0.5)*Math.sin(y*0.3);
      solver.v[i] = Math.cos(y*0.4)*Math.sin(z*0.3);
      solver.w[i] = Math.sin(z*0.5)*Math.cos(x*0.2);
    }
    const before = solver.divergenceRms();
    solver.project();
    expect(solver.divergenceRms()).toBeLessThan(before*0.8);
  });
  it('keeps vacuum free of water and optical density', () => {
    const solver = new WeatherSolver({ ...defaults,pressure:0 });
    solver.step(3);
    const snapshot = solver.snapshot();
    expect(snapshot.stats.cloudMass).toBe(0);
    const densities = snapshot.data.filter((_,i) => i%4 === 3);
    expect(Math.max(...densities)).toBe(0);
  });
});
