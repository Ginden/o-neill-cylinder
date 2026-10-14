import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/** The render worker's latest report on the image. */
export interface RenderReport { samples: number; mode: 'preview' | 'path'; raySize: string; accumulation: number }
/** Every given field must hold. `accumulationAbove` asks for an image started
 * after that accumulation, such as the first image after a settings change. */
export interface RenderCondition {
  mode?: RenderReport['mode']; samplesAbove?: number; raySize?: string; raySizeNot?: string; accumulationAbove?: number;
}

export function renderReport(page: Page) {
  return page.locator('#scene').evaluate((canvas: HTMLCanvasElement): RenderReport => ({
    samples: Number(canvas.dataset.samples), mode: canvas.dataset.mode as RenderReport['mode'],
    raySize: canvas.dataset.raySize ?? '', accumulation: Number(canvas.dataset.accumulation)
  }));
}

/** Resolves on the first report that meets the condition: the latest one, or a
 * later `renderstate` event. Checking and listening happen in one page task. */
export function untilRender(page: Page, condition: RenderCondition) {
  return page.locator('#scene').evaluate((canvas: HTMLCanvasElement, wanted: RenderCondition) => new Promise<void>(resolve => {
    const met = (report: RenderReport) => (wanted.mode === undefined || report.mode === wanted.mode)
      && (wanted.samplesAbove === undefined || report.samples > wanted.samplesAbove)
      && (wanted.raySize === undefined || report.raySize === wanted.raySize)
      && (wanted.raySizeNot === undefined || report.raySize !== wanted.raySizeNot)
      && (wanted.accumulationAbove === undefined || report.accumulation > wanted.accumulationAbove);
    const latest = { samples: Number(canvas.dataset.samples), mode: canvas.dataset.mode as RenderReport['mode'],
      raySize: canvas.dataset.raySize ?? '', accumulation: Number(canvas.dataset.accumulation) };
    if (canvas.dataset.samples !== undefined && met(latest)) { resolve(); return; }
    const listener = (event: Event) => {
      if (!met((event as CustomEvent<RenderReport>).detail)) return;
      canvas.removeEventListener('renderstate', listener); resolve();
    };
    canvas.addEventListener('renderstate', listener);
  }), condition);
}

/** Page load does not wait for shader compilation in the render worker. */
export async function waitForScene(page: Page) {
  await untilRender(page, { samplesAbove: 0 });
}

/** Read the presented bitmap; its WebGL context belongs to the render worker. */
export async function canvasPixels(page: Page) {
  return page.locator('#scene').evaluate((canvas: HTMLCanvasElement) => {
    const copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    const context = copy.getContext('2d')!;
    context.drawImage(canvas, 0, 0);
    const rgba = context.getImageData(0, 0, copy.width, copy.height).data;
    let sum = 0, min = 255, max = 0;
    for (let i = 0; i < rgba.length; i += 16) {
      sum += rgba[i]; min = Math.min(min, rgba[i]); max = Math.max(max, rgba[i]);
    }
    return { mean: sum / (rgba.length / 16), min, max, width: copy.width, height: copy.height };
  });
}

/** The same statistics for the image the render worker has drawn, saved through
 * *Save image*. Unlike the page's canvas, it does not wait for the compositor,
 * so it shows the sample a render report announced. */
export async function savedPixels(page: Page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Save image/ }).click();
  const png = await readFile((await (await download).path())!);
  return page.evaluate(async base64 => {
    const image = await createImageBitmap(await fetch(`data:image/png;base64,${base64}`).then(response => response.blob()));
    const context = new OffscreenCanvas(image.width, image.height).getContext('2d')!;
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, image.width, image.height).data;
    let sum = 0, min = 255, max = 0;
    for (let i = 0; i < rgba.length; i += 16) {
      sum += rgba[i]; min = Math.min(min, rgba[i]); max = Math.max(max, rgba[i]);
    }
    const result = { mean: sum / (rgba.length / 16), min, max, width: image.width, height: image.height };
    image.close();
    return result;
  }, png.toString('base64'));
}

export function captureErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
