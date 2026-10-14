import { describe, expect, it } from 'vitest';
import { CACHE_ANGULAR, CACHE_AXIAL, CACHE_RADIAL, DEEP_TRANSPORT, cacheRadii, diffusionCells } from '../src/render/cache';
import { asymmetry, particleOptics, PHASE_TABLE_SIZE } from '../src/render/mie';
import { defaults } from '../src/settings';

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
});
