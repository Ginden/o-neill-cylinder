import type { Page } from '@playwright/test';

/** Page load no longer waits for shader compilation in the render worker. */
export async function waitForScene(page: Page) {
  await page.waitForFunction(() => Number(document.querySelector<HTMLCanvasElement>('#scene')?.dataset.samples) > 0);
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

export function captureErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
