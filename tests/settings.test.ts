import { describe, expect, it } from 'vitest';
import { parseSettings } from '../src/ui/controls';
import { defaults } from '../src/settings';

describe('imported experiments', () => {
  it('round-trips settings without losing display or physical parameters', () => {
    const s = { ...defaults, radius:8, pressure:700, lightMode:'sun' as const, paused:true, adaptiveExposure:false, diagnostic:'density' as const };
    expect(parseSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it('rejects malformed values and constrains geometry to renderable physical ranges', () => {
    expect(() => parseSettings({ radius:'giant' })).toThrow();
    expect(() => parseSettings({ quality:'ultra' })).toThrow();
    expect(() => parseSettings({ clouds:'yes' })).toThrow();
    expect(() => parseSettings({ adaptiveExposure:'yes' })).toThrow();
    const imported = parseSettings({ radius:0.5,terrainHeight:0.4,pressure:-20 });
    expect(imported.terrainHeight).toBeLessThanOrEqual(0.1);
    expect(imported.pressure).toBe(0);
  });
});
