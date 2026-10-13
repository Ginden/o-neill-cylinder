import { describe, expect, it } from 'vitest';
import { atlasSize } from '../src/render/preview';

describe('ground atlas', () => {
  it('keeps occupancy mip texels aligned with the base texels below them', () => {
    // Odd intermediate mip sizes drop rows, so an empty mip texel would no
    // longer prove that the land under it is empty.
    for (const [radius, length] of [[4, 24], [1, 8], [12, 60], [0.5, 80], [20, 2]]) for (const limit of [2048, 4096]) {
      const [width, height] = atlasSize(radius, length, limit);
      expect(width % 32).toBe(0);
      expect(height % 32).toBe(0);
      expect(height).toBeLessThanOrEqual(limit);
      expect(height).toBeGreaterThanOrEqual(256);
    }
  });
  it('uses nearly square texels in the default habitat', () => {
    const [width, height] = atlasSize(4, 24, 4096);
    expect((2 * Math.PI * 4 / width) / (24 / height)).toBeCloseTo(1, 1);
  });
});
