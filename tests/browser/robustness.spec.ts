import { expect, test } from '@playwright/test';
import { openIsolatedPage } from './isolated';

test('reports context loss from the render worker', async ({ page }) => {
  await openIsolatedPage(page);
  const message = await page.evaluate(async () => {
    const module = '/src/settings.ts';
    const { defaults } = await import(module);
    const source = `
      let context;
      const getContext = OffscreenCanvas.prototype.getContext;
      OffscreenCanvas.prototype.getContext = function(...args) {
        const result = getContext.apply(this, args);
        if (args[0] === 'webgl2') context = result;
        return result;
      };
      const send = globalThis.postMessage.bind(globalThis);
      let lost = false;
      globalThis.postMessage = message => {
        send(message);
        if (message.type === 'stats' && !lost) {
          lost = true;
          context.getExtension('WEBGL_lose_context').loseContext();
        }
      };
      await import(${JSON.stringify(new URL('/src/render/worker.ts', location.href).href)});
      send({ type: 'ready' });
    `;
    const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    const worker = new Worker(url, { type: 'module' });
    try {
      return await new Promise<string>((resolve, reject) => {
        worker.onerror = event => reject(new Error(event.message));
        worker.onmessage = ({ data }) => {
          if (data.type === 'error') resolve(data.message);
          if (data.type !== 'ready') return;
          const canvas = new OffscreenCanvas(32, 32);
          worker.postMessage({ type: 'init', canvas, state: {
            settings: { ...defaults, quality: 'fast', paused: true }, width: 32, height: 32,
            pixelRatio: 1, position: [0, -3.8, 0], quaternion: [0, 0, 0, 1], interacting: true, resetWeather: false
          } }, [canvas]);
        };
      });
    } finally { worker.terminate(); URL.revokeObjectURL(url); }
  });
  expect(message).toMatch(/context.*lost/i);
});

test('rejects a device without linear float-texture filtering', async ({ page }) => {
  await openIsolatedPage(page);
  const message = await page.evaluate(async () => {
    const rendererModule = '/src/render/renderer.ts', settingsModule = '/src/settings.ts';
    const { HabitatRenderer } = await import(rendererModule), { defaults } = await import(settingsModule);
    const original = WebGL2RenderingContext.prototype.getExtension;
    Object.defineProperty(WebGL2RenderingContext.prototype, 'getExtension', { value: function(this: WebGL2RenderingContext, name: string) {
      return name === 'OES_texture_float_linear' ? null : (original as (name: string) => unknown).call(this, name);
    }, configurable: true, writable: true });
    try {
      const renderer = new HabitatRenderer(document.createElement('canvas'), defaults);
      renderer.dispose();
      return '';
    } catch (error) { return String(error); }
    finally { WebGL2RenderingContext.prototype.getExtension = original; }
  });
  expect(message).toMatch(/linear.*float/i);
});

test('switches cloud tracking and bands when a field gains and loses condensate', async ({ page }) => {
  await openIsolatedPage(page);
  const states = await page.evaluate(async () => {
    const rendererModule = '/src/render/renderer.ts', settingsModule = '/src/settings.ts', weatherModule = '/src/weather/solver.ts';
    const { HabitatRenderer } = await import(rendererModule), { defaults } = await import(settingsModule);
    const { WeatherSolver } = await import(weatherModule);
    const settings = { ...defaults, clouds: true, paused: true };
    const renderer = new HabitatRenderer(document.createElement('canvas'), settings);
    renderer.resize(512, 512, 'balanced', 1);
    const dry = { ...new WeatherSolver(settings).snapshot(), revision: 1 };
    const humid = { ...new WeatherSolver({ ...settings, humidity: 78 }).snapshot(), revision: 1 };
    const states: { clouds: boolean; bands: number }[] = [];
    const record = () => states.push({ clouds: renderer.material.uniforms.uClouds.value, bands: renderer.bands });
    renderer.setWeather(dry); record();
    renderer.apply({ ...settings, exposure: 2 }); record();
    renderer.setWeather(humid); record();
    renderer.apply({ ...settings, exposure: 3 }); record();
    renderer.apply({ ...settings, clouds: false }); record();
    renderer.apply(settings); record();
    renderer.setWeather(dry); record();
    renderer.dispose();
    return states;
  });
  expect(states.map(state => state.clouds)).toEqual([false, false, true, true, false, true, false]);
  expect(states[0].bands).toBe(states[1].bands);
  expect(states[2].bands).toBeGreaterThan(states[0].bands);
  expect(states[3].bands).toBe(states[2].bands);
  expect(states[4].bands).toBe(states[0].bands);
  expect(states[5].bands).toBe(states[2].bands);
  expect(states[6].bands).toBe(states[0].bands);
});
