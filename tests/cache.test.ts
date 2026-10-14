import { describe, expect, it } from 'vitest';
import { CACHE_ANGULAR, CACHE_AXIAL, CACHE_RADIAL, CACHE_WAVELENGTHS, DEEP_TRANSPORT, cacheRadii, diffusionCells } from '../src/render/cache';
import { asymmetry, particleOptics, PHASE_TABLE_SIZE } from '../src/render/mie';
import { defaults } from '../src/settings';
import { backgroundAt, rayleighPerKm } from '../src/physics';

const populations: [ReturnType<typeof particleOptics>, ReturnType<typeof particleOptics>] =
  [particleOptics(defaults.aerosolRadius, 0.35, [1.5, 0.01]), particleOptics(defaults.cloudRadius, 0.35, [1.333, 1e-9])];
const settings = { ...defaults, clouds: true };

function uniformFog(liquid: number) {
  const data = new Float32Array(24 * 24 * 48 * 4);
  for (let i = 0; i < data.length; i += 4) data[i] = liquid;
  return { data, dimensions: [24, 24, 48] as const };
}
const cell = (i: number, j: number, k: number) => (j + CACHE_ANGULAR * (i + CACHE_RADIAL * k)) * 4;

describe('cloud cache diffusion cells', () => {
  it('marks no deep cells without clouds', () => {
    const { diffusion, absorption } = diffusionCells(undefined, settings, populations);
    expect(diffusion.every(value => value < 0)).toBe(true);
    expect(absorption.every(value => value >= 0)).toBe(true);
  });

  it('marks no deep cells in fog thinner than the diffusion threshold', () => {
    // 2e-5 kg/m³ of 10 µm droplets: σ ≈ 3/km, transport coefficient ≈ 0.4/km.
    const { diffusion } = diffusionCells(uniformFog(2e-5), settings, populations);
    expect(diffusion.some(value => value > 0)).toBe(false);
  });

  it('uses diffusion only in thick fog away from terrain, windows and endcaps', () => {
    const { diffusion } = diffusionCells(uniformFog(2e-3), settings, populations);
    const clearance = settings.radius - 1.84 * settings.terrainHeight - 0.04;
    for (let k = 0; k < CACHE_AXIAL; k++) for (let i = 0; i < CACHE_RADIAL; i++) {
      const deep = diffusion[cell(i, 0, k)] > 0;
      const allowed = k > 0 && k < CACHE_AXIAL - 1 && i > 0 && cacheRadii(i - 1, settings.radius).outer < clearance;
      expect(deep, `radial ${i}, axial ${k}`).toBe(allowed);
    }
    // D = 1/(3 σ_tr) at the 500 nm node. Droplets dominate; air adds well under 1%.
    const bin = 12, row = bin * PHASE_TABLE_SIZE * 4, data = populations[1].data;
    const scattering = data[row + 3] * 2e-3, absorption = (data[row + 2] - data[row + 3]) * 2e-3;
    const transport = absorption + scattering * (1 - asymmetry(data, bin));
    expect(transport).toBeGreaterThan(DEEP_TRANSPORT);
    const center = cell(CACHE_RADIAL - 2, 10, CACHE_AXIAL / 2);
    expect(Math.abs(diffusion[center + 1] * 3 * transport - 1)).toBeLessThan(0.01);
  });

  it('samples a nonuniform cloud field with clamped trilinear interpolation at different grid and habitat sizes', () => {
    // A trilinear polynomial is reproduced exactly between texel centers.
    const liquid = (x:number,y:number,z:number) => 0.002*(1+0.2*x-0.15*y+0.1*z+0.3*x*y+0.4*y*z+0.2*x*z+0.1*x*y*z);
    for (const dimensions of [[24,24,48],[6,10,12],[24,24,48]] as const) {
      const [nx,ny,nz] = dimensions, data = new Float32Array(nx*ny*nz*4);
      for (let z=0;z<nz;z++) for (let y=0;y<ny;y++) for (let x=0;x<nx;x++) {
        data[(x+nx*(y+ny*z))*4] = liquid((x+0.5)/nx,(y+0.5)/ny,(z+0.5)/nz);
      }
      for (const size of [{radius:4,length:24},{radius:1.7,length:7.3}]) {
        const s = {...settings,...size,aerosol:0};
        const {diffusion,absorption} = diffusionCells({data,dimensions},s,populations);
        for (const i of [0,4,20,31]) for (const j of [0,23,47,71,95]) for (const k of [0,17,63]) {
          const {outer,inner} = cacheRadii(i,s.radius), r = (outer+inner)/2;
          const theta = (j+0.5)/CACHE_ANGULAR*2*Math.PI;
          const clamp = (p:number,n:number) => Math.max(0.5/n,Math.min(1-0.5/n,p));
          const water = liquid(clamp(0.5+r*Math.cos(theta)/(2*s.radius),nx),clamp(0.5+r*Math.sin(theta)/(2*s.radius),ny),clamp((k+0.5)/CACHE_AXIAL,nz));
          const air = backgroundAt(r,s), density = air.pressure/101325*288.15/air.temperature;
          for (let n=0;n<4;n++) {
            const bin = (CACHE_WAVELENGTHS[n]-380)/10, row = bin*PHASE_TABLE_SIZE*4, optics = populations[1].data;
            const sigmaA = (optics[row+2]-optics[row+3])*water;
            const transport = sigmaA+optics[row+3]*water*(1-asymmetry(optics,bin))+rayleighPerKm(CACHE_WAVELENGTHS[n])*density;
            expect(Math.abs(diffusion[cell(i,j,k)+n])*3*transport).toBeCloseTo(1,6);
            expect(absorption[cell(i,j,k)+n]).toBeCloseTo(sigmaA,8);
          }
        }
      }
    }
  });
});
