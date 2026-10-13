/* global console, document, performance, PerformanceObserver, requestAnimationFrame, URL, Event */
// Run against npm run dev (or BENCHMARK_URL). Use a hardware GPU for meaningful
// throughput; report UI cadence separately from completed spectral samples.
import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: (process.env.BENCHMARK_GPU_ARGS ?? '').split(' ').filter(Boolean)
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => console.error(error.message));
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.addInitScript(() => {
    globalThis.longTasks = [];
    new PerformanceObserver(list => globalThis.longTasks.push(...list.getEntries().map(entry => entry.duration)))
      .observe({ type: 'longtask', buffered: true });
  });
  const url = new URL(process.env.BENCHMARK_URL ?? 'http://127.0.0.1:5173/');
  url.searchParams.set('s', Buffer.from(JSON.stringify({ quality: 'balanced', clouds: false, paused: true })).toString('base64'));
  await page.goto(url.toString());
  await page.waitForFunction(() => Number(document.querySelector('#scene')?.dataset.samples) > 8, {}, { timeout: 120000 });

  async function measure(duration, changeParticles = false) {
    return page.evaluate(({ duration, changeParticles }) => new Promise(resolve => {
      const canvas = document.querySelector('#scene'), start = performance.now(), samples = Number(canvas.dataset.samples);
      const gaps = [];
      let last = start;
      globalThis.longTasks = [];
      function frame(now) {
        gaps.push(now - last); last = now;
        if (now - start < duration) requestAnimationFrame(frame);
        else resolve({
          samplesPerSecond: (Number(canvas.dataset.samples) - samples) / ((now - start) / 1000),
          uiFPS: gaps.length / ((now - start) / 1000), maxGapMs: Math.max(...gaps), longTasksMs: globalThis.longTasks
        });
      }
      requestAnimationFrame(frame);
      if (changeParticles) {
        const input = document.querySelector('#cloudRadius');
        input.value = '20'; input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }), { duration, changeParticles });
  }

  const steady = await measure(5000);
  const box = await page.locator('#scene').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => document.querySelector('#scene').dataset.mode === 'preview');
  const navigation = await measure(3000);
  await page.mouse.up();
  await page.getByRole('tab', { name: 'light', exact: true }).click();
  const particle = await measure(4000, true);
  // Particle changes reset accumulation, so a sample-rate difference is invalid.
  delete particle.samplesPerSecond;
  const environment = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return { gpu: gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER), raySize: document.querySelector('#scene').dataset.raySize };
  });
  console.log(JSON.stringify({ environment, steady, navigation, particle }, null, 2));
} finally {
  await browser.close();
}
