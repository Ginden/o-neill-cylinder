import { describe, expect, it } from 'vitest';
import { defaults } from '../src/settings';
import { WeatherSolver } from '../src/weather/solver';

describe('moist convection solver', () => {
  it('keeps unsaturated default air at exactly zero cloud mass', () => {
    const solver = new WeatherSolver({ ...defaults, clouds:true });
    expect(solver.snapshot().stats.cloudMass).toBe(0);
    solver.step(4);
    expect(solver.snapshot().stats.cloudMass).toBe(0);
  });
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
  it('advects distinct linear temperature and vapor profiles along the same wind', () => {
    const solver = new WeatherSolver({ ...defaults, gravity:0, lapseRate:0, evaporation:0, surfaceHeating:0 });
    const temperature = (x:number,y:number,z:number) => 0.2 + 0.04*x + 0.02*y - 0.003*z;
    const vapor = (x:number,y:number,z:number) => 0.001 + 0.00001*x - 0.00002*y + 0.00003*z;
    for (let i = 0; i < solver.count; i++) {
      if (!solver.active[i]) continue;
      const x = i % solver.nx, y = Math.floor(i / solver.nx) % solver.ny, z = Math.floor(i / (solver.nx*solver.ny));
      solver.u[i] = 10;solver.v[i] = -5;solver.w[i] = 20;
      solver.temperature[i] = temperature(x,y,z);solver.vapor[i] = vapor(x,y,z);solver.cloud[i] = 0;
    }
    const dt = solver.step(4);
    for (const [x,y,z] of [[12,13,5],[8,10,30],[14,9,40]]) {
      const i = x + solver.nx*(y + solver.ny*z);
      const source = [x-10*dt/solver.dx,y+5*dt/solver.dy,z-20*dt/solver.dz] as const;
      expect(solver.temperature[i]).toBeCloseTo(temperature(...source)*Math.exp(-dt/2400), 6);
      expect(solver.vapor[i]).toBeCloseTo(vapor(...source), 9);
    }
  });
  it('preserves uniform vapor when backtraces touch the sealed wall', () => {
    const solver = new WeatherSolver({ ...defaults, gravity:0, lapseRate:0, evaporation:0, surfaceHeating:0 });
    for (let i = 0; i < solver.count; i++) {
      // Solid cells deliberately differ: they must not dilute active parcels.
      solver.vapor[i] = solver.active[i] ? 0.002 : 0;
      solver.cloud[i] = 0;solver.u[i] = 30;solver.v[i] = -20;solver.w[i] = 10;
    }
    solver.step(4);
    let maximumError = 0;
    for (let i = 0; i < solver.count; i++) {
      if (solver.active[i]) maximumError = Math.max(maximumError, Math.abs(solver.vapor[i] - 0.002));
    }
    expect(maximumError).toBeLessThan(1e-9);
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
    expect(solver.divergenceRms()).toBeLessThan(before*0.001);
  });
  it('projects a grid-scale axial wave without retaining half its divergence', () => {
    const solver = new WeatherSolver({ ...defaults, wind:0, humidity:0 });
    for (let i = 0; i < solver.count; i++) {
      if (!solver.active[i]) continue;
      const z = Math.floor(i / (solver.nx * solver.ny));
      solver.w[i] = z === 0 || z === solver.nz - 1 ? 0 : Math.sin(Math.PI * z / 2);
    }
    const before = solver.divergenceRms();
    solver.project();
    expect(solver.divergenceRms()).toBeLessThan(before * 0.001);
  });
  it('preserves a divergence-free rotation and does not add kinetic energy when projecting', () => {
    const solver = new WeatherSolver({ ...defaults, wind:0, humidity:0 });
    for (let i = 0; i < solver.count; i++) {
      if (!solver.active[i]) continue;
      const x = (i % solver.nx + 0.5 - solver.nx / 2) * solver.dx;
      const y = (Math.floor(i / solver.nx) % solver.ny + 0.5 - solver.ny / 2) * solver.dy;
      // Compact support keeps this analytic solenoidal flow away from the stair-step wall.
      const radial = Math.max(0, 1 - (x*x + y*y) / (solver.settings.radius * 600) ** 2) ** 2;
      solver.u[i] = -y * radial / 1000;solver.v[i] = x * radial / 1000;
    }
    const energy = () => solver.u.reduce((sum,u,i) => sum + u*u + solver.v[i]**2 + solver.w[i]**2, 0);
    const before = energy(), divergence = solver.divergenceRms();
    solver.project();
    expect(energy()).toBeLessThanOrEqual(before * (1 + 1e-6));
    expect(energy()).toBeGreaterThan(before * 0.99);
    expect(solver.divergenceRms()).toBeLessThan(divergence * 0.001);
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
