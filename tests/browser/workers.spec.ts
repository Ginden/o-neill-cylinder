import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openIsolatedPage } from './isolated';
import { captureErrors, waitForScene } from './canvas';

test('parallel optics agree with serial tables and discard superseded particle sizes', async ({ page }) => {
  await openIsolatedPage(page);
  const errors = captureErrors(page);
  const result = await page.evaluate(async () => {
    const poolModule = '/src/render/particles.ts', mieModule = '/src/render/mie.ts';
    const { ParticlePool } = await import(poolModule), { particleOptics } = await import(mieModule);
    const pool = new ParticlePool(3);
    type Table = { data: Float32Array; maximumExtinction: number; greenExtinction: number };
    const initial = await new Promise<[Table, Table]>(resolve => pool.request(0.15, 0.8, resolve));
    let staleResults = 0;
    pool.request(0.4, 20, () => staleResults++);
    pool.request(0.3, 12, () => staleResults++);
    const latest = await new Promise<[Table, Table]>(resolve => pool.request(0.15, 0.6, resolve));
    const expected = [particleOptics(0.15, 0.35, [1.5, 0.01]), particleOptics(0.6, 0.35, [1.333, 1e-9])];
    const differences = latest.map((actual, population) => {
      const reference = expected[population];
      let maximum = 0;
      for (let i = 0; i < actual.data.length; i++) maximum = Math.max(maximum, Math.abs(actual.data[i] - reference.data[i]));
      return { maximum, extinction: actual.maximumExtinction - reference.maximumExtinction, green: actual.greenExtinction - reference.greenExtinction };
    });
    pool.dispose();
    return { staleResults, differences, reusedAerosol: initial[0] === latest[0] };
  });
  expect(errors).toEqual([]);
  expect(result.staleResults).toBe(0);
  expect(result.reusedAerosol).toBe(true);
  for (const difference of result.differences) {
    expect(difference.maximum).toBeLessThan(1e-6);
    expect(difference.extinction).toBeCloseTo(0, 6);
    expect(difference.green).toBeCloseTo(0, 6);
  }
});

test('exports the worker canvas after resizing and changing quality', async ({ page }) => {
  const errors = captureErrors(page);
  await page.goto('/?s=' + Buffer.from(JSON.stringify({ quality: 'fast', clouds: false, paused: true })).toString('base64'));
  await waitForScene(page);
  const canvas = page.locator('#scene');
  await expect.poll(async () => Number(await canvas.getAttribute('data-samples'))).toBeGreaterThan(2);
  const firstSize = await canvas.getAttribute('data-ray-size');
  await page.setViewportSize({ width: 900, height: 700 });
  await page.getByRole('tab', { name: 'display', exact: true }).click();
  await page.locator('#quality').selectOption('balanced');
  await expect.poll(() => canvas.getAttribute('data-ray-size')).not.toBe(firstSize);
  // Balanced changes the atlas as well as the ray budget; SwiftShader may
  // need several seconds to bake it before the resized image is presented.
  await page.waitForFunction(() => {
    const node = document.querySelector<HTMLCanvasElement>('#scene')!;
    const expected = `${Math.floor(node.clientWidth * devicePixelRatio)}×${Math.floor(node.clientHeight * devicePixelRatio)}`;
    return node.dataset.raySize === expected && Number(node.dataset.samples) > 0;
  });
  const dimensions = await canvas.evaluate((node: HTMLCanvasElement) => ({ width: node.width, height: node.height }));
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Save image/ }).click();
  const download = await downloadEvent;
  const path = test.info().outputPath('worker-canvas.png');
  await download.saveAs(path);
  const png = await readFile(path);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(png.readUInt32BE(16)).toBe(dimensions.width);
  expect(png.readUInt32BE(20)).toBe(dimensions.height);
  const range = await page.evaluate(async base64 => {
    const image = await createImageBitmap(await fetch(`data:image/png;base64,${base64}`).then(response => response.blob()));
    const context = new OffscreenCanvas(image.width, image.height).getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let minimum = 255, maximum = 0;
    for (let i = 0; i < pixels.length; i += 4) { minimum = Math.min(minimum, pixels[i]); maximum = Math.max(maximum, pixels[i]); }
    image.close();
    return maximum - minimum;
  }, png.toString('base64'));
  expect(range).toBeGreaterThan(50);
  expect(errors).toEqual([]);
});

test('splitting GPU work preserves complete samples and abandons interrupted samples', async ({ page }) => {
  await openIsolatedPage(page);
  const result = await page.evaluate(async () => {
    const rendererModule = '/src/render/renderer.ts', settingsModule = '/src/settings.ts', navigationModule = '/src/render/navigation.ts';
    const { HabitatRenderer } = await import(rendererModule), { defaults } = await import(settingsModule), { Navigation } = await import(navigationModule);
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const settings = { ...defaults, quality: 'fast', clouds: false, paused: true, adaptiveExposure: false };
    const renderer = new HabitatRenderer(canvas, settings);
    const navigation = new Navigation(renderer.camera, canvas, settings);
    renderer.resize(64, 48, 'fast', 1);
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const accumulate = async () => { while (renderer.samples < 3) { renderer.render(); await frame(); } };
    const read = () => {
      const target = renderer.targets[renderer.targetIndex];
      const pixels = new Float32Array(target.width * target.height * 4);
      renderer.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);
      return pixels;
    };
    await accumulate();
    const reference = read();
    // Force four small bands so SwiftShader can verify partial-frame behavior
    // without tracing a hardware-sized image. This exercises the production band renderer.
    renderer.bands = 4;
    navigation.setView('axis');
    while (!renderer.sampleInProgress) { renderer.render(); await frame(); }
    const partialSamples = renderer.samples;
    navigation.setView('valley');
    await accumulate();
    const actual = read();
    let maximumDifference = 0;
    for (let i = 0; i < reference.length; i++) maximumDifference = Math.max(maximumDifference, Math.abs(reference[i] - actual[i]));
    const error = renderer.renderer.getContext().getError();
    renderer.dispose(); canvas.remove();
    return { partialSamples, maximumDifference, error };
  });
  expect(result.partialSamples).toBe(0);
  expect(result.maximumDifference).toBeLessThan(1e-6);
  expect(result.error).toBe(0);
});
