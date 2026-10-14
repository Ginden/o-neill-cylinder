import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { Navigation } from '../src/render/navigation';
import { defaults } from '../src/settings';
import { surfaceHeight, terrainAtlasSize } from '../src/terrain';

/** A canvas that only collects listeners, so tests can press keys. */
function fakeCanvas() {
  const listeners = new Map<string, (event: unknown) => void>();
  const canvas = { addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener) };
  const key = (type: 'keydown' | 'keyup', code: string) => listeners.get(type)!({ code, preventDefault() {} });
  return { canvas: canvas as unknown as HTMLCanvasElement, key };
}

describe('ground view', () => {
  const settings = { ...defaults, view: 'ground' as const };
  const eyeHeight = (camera: PerspectiveCamera) => {
    const { x, y, z } = camera.position;
    return settings.radius - Math.hypot(x, y) - surfaceHeight(Math.atan2(y, x), z, settings, terrainAtlasSize(settings));
  };

  it('keeps the eye at standing height while walking over the terrain', () => {
    const camera = new PerspectiveCamera(), { canvas, key } = fakeCanvas();
    const navigation = new Navigation(camera, canvas, settings);
    expect(eyeHeight(camera)).toBeCloseTo(0.0017, 9);
    const start = camera.position.clone();
    key('keydown', 'KeyW');
    for (let frame = 0; frame < 60; frame++) navigation.update(0.1);
    key('keyup', 'KeyW');
    expect(camera.position.distanceTo(start)).toBeGreaterThan(0.02);
    expect(eyeHeight(camera)).toBeCloseTo(0.0017, 9);
  });

  it('rises above the ground and settles back to standing height', () => {
    const camera = new PerspectiveCamera(), { canvas, key } = fakeCanvas();
    const navigation = new Navigation(camera, canvas, settings);
    key('keydown', 'KeyE');
    for (let frame = 0; frame < 10; frame++) navigation.update(0.1);
    key('keyup', 'KeyE');
    expect(eyeHeight(camera)).toBeGreaterThan(0.01);
    key('keydown', 'KeyQ');
    for (let frame = 0; frame < 100; frame++) navigation.update(0.1);
    expect(eyeHeight(camera)).toBeCloseTo(0.0017, 9);
  });
});
