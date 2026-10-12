import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function settleRender(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function pixels(page: Page) {
  return page.locator('#scene').evaluate((canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext('webgl2')!;
    const rgba = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
    let sum = 0, min = 255, max = 0;
    for (let i = 0; i < rgba.length; i += 16) {
      sum += rgba[i]; min = Math.min(min,rgba[i]); max = Math.max(max,rgba[i]);
    }
    return { mean: sum/(rgba.length/16),min,max,width:canvas.width,height:canvas.height };
  });
}

test('renders a varied landscape without shader errors and exposes physical comparisons', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror',error => errors.push(error.message));
  page.on('console',message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  // Fast rendering makes this a shader correctness check even on software graphics.
  await page.goto('/?s='+Buffer.from(JSON.stringify({ quality:'fast',clouds:false,paused:true })).toString('base64'));
  await expect(page.locator('#render-state')).toContainText('Live light transport');
  await settleRender(page);
  const natural = await pixels(page);
  expect(natural.max-natural.min).toBeGreaterThan(70);
  expect(natural.mean).toBeGreaterThan(10);
  await page.screenshot({ path:'test-results/clear-daylight.png' });
  await page.getByRole('tab',{ name:'display',exact:true }).click();
  await page.locator('#diagnostic').selectOption('transmission');
  await settleRender(page);
  const air = await pixels(page);
  expect(air.min).toBeLessThan(240);
  await page.locator('#atmosphere').uncheck();
  await settleRender(page);
  const vacuum = await pixels(page);
  expect(vacuum.min).toBeGreaterThan(253);
  expect(vacuum.mean).toBeGreaterThan(air.mean+3);
  await page.locator('#atmosphere').check();
  await page.locator('#diagnostic').selectOption('natural');
  await page.getByRole('button',{ name:'Axis',exact:true }).click();
  await settleRender(page);
  await page.screenshot({ path:'test-results/axis-view.png' });
  await page.getByRole('button',{ name:'Model & assumptions ↗' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Boussinesq');
  await page.getByRole('button',{ name:'Close model notes' }).click();
  expect(errors).toEqual([]);
});

test('updates the habitat, evolves weather, and round-trips an exported experiment', async ({ page }) => {
  await page.goto('/?s='+Buffer.from(JSON.stringify({ quality:'fast',timeScale:300,humidity:78,clouds:true })).toString('base64'));
  await expect(page.locator('#render-state')).toContainText('Live light transport');
  await page.getByRole('tab',{ name:'weather',exact:true }).click();
  await expect(page.locator('#cloud-fraction')).not.toHaveText('—');
  await expect(page.locator('#sim-time')).not.toHaveText('00:00:00');
  await page.getByRole('button',{ name:'Pause weather',exact:true }).click();
  await settleRender(page);
  await page.screenshot({ path:'test-results/humid-afternoon.png' });
  await page.getByRole('tab',{ name:'habitat',exact:true }).click();
  await page.locator('#radius').fill('8');
  await expect(page.locator('#radius-value')).toContainText('8 km');
  await expect(page.locator('#rotation')).toContainText('2.99 min');
  await page.getByRole('tab',{ name:'display',exact:true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button',{ name:'Export experiment JSON' }).click();
  const download = await downloadEvent;
  await download.saveAs('test-results/experiment.json');
  const exported = JSON.parse(await readFile('test-results/experiment.json','utf8'));
  expect(exported.radius).toBe(8);
  expect(exported.paused).toBe(true);
  await page.getByRole('tab',{ name:'habitat',exact:true }).click();
  await page.locator('#radius').fill('2');
  await page.locator('#pressure').fill('500');
  await page.getByRole('tab',{ name:'display',exact:true }).click();
  await page.locator('#import-settings').setInputFiles('test-results/experiment.json');
  await expect(page.locator('#toast')).toContainText('Experiment imported');
  await page.getByRole('tab',{ name:'habitat',exact:true }).click();
  await expect(page.locator('#radius-value')).toContainText('8 km');
  await expect(page.locator('#pressure-value')).toContainText('1013.25 hPa');
  await page.getByRole('button',{ name:'Copy link',exact:true }).click();
  await expect(page).toHaveURL(/s=/);
  await page.reload();
  await expect(page.locator('#radius-value')).toContainText('8 km');
  await expect(page.locator('#pressure-value')).toContainText('1013.25 hPa');
});

test('keeps the experiment usable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width:390,height:844 });
  await page.goto('/?s='+Buffer.from(JSON.stringify({ quality:'fast',clouds:false,paused:true })).toString('base64'));
  await expect(page.locator('#render-state')).toContainText('Live light transport');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path:'test-results/mobile.png',fullPage:true });
  await page.getByRole('tab',{ name:'light',exact:true }).click();
  await page.locator('#lightMode').selectOption('sun');
  await expect(page.locator('#lightMode')).toHaveValue('sun');
});
