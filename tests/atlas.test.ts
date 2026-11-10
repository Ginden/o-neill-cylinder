import { describe, expect, it } from 'vitest';
import { atlasSize } from '../src/terrain';

describe('ground atlas', () => {
  it('keeps occupancy mip texels aligned with the base texels below them', () => {
    // Odd intermediate mip sizes drop rows, so an empty mip texel would no
    // longer prove that the land under it is empty.
    for (const [radius, length] of [[4, 24], [1, 8], [12, 60], [0.5, 80], [20, 2]]) for (const limit of [2048, 4096]) {
      const [width, height] = atlasSize(radius, length, limit);
      expect(width % 32).toBe(0);
      expect(height % 32).toBe(0);
      expect(height).toBeLessThanOrEqual(limit);
      expect(height).toBeGreaterThanOrEqual(32);
      expect(width).toBeLessThanOrEqual(limit);
      expect(width).toBeGreaterThanOrEqual(32);
    }
  });
  it.each([[4, 24], [0.5, 80], [20, 2]])('uses nearly square texels at radius %s and length %s', (radius, length) => {
    const [width, height] = atlasSize(radius, length, 4096);
    expect((2 * Math.PI * radius / width) / (length / height)).toBeCloseTo(1, 1);
  });
});
