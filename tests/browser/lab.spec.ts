import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
// Pixel statistics come from the image the worker drew for the reported sample.
import { captureErrors, renderReport, savedPixels as pixels, untilRender, waitForScene } from './canvas';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { errors.set(page, captureErrors(page)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

/** Waits for the first sample rendered after `change`, or for the next sample. */
async function settleRender(page: Page, change?: () => Promise<unknown>) {
  const before = await renderReport(page);
  if (!change) return untilRender(page, { samplesAbove: before.samples });
  await change();
  await untilRender(page, { accumulationAbove: before.accumulation, samplesAbove: 0 });
}

test('renders a varied landscape without shader errors and exposes physical comparisons', async ({ page }) => {
  // Fast rendering makes this a shader correctness check even on software graphics.
  await page.goto('/?s='+Buffer.from(JSON.stringify({ quality:'fast',clouds:false,paused:true })).toString('base64'));
  await waitForScene(page);
  await untilRender(page, { mode:'path' });
  await settleRender(page);
  expect(errors.get(page)).toEqual([]);
  const natural = await pixels(page);
  expect(natural.max-natural.min).toBeGreaterThan(70);
  expect(natural.mean).toBeGreaterThan(10);
  await page.screenshot({ path:'test-results/clear-daylight.png' });
  await page.getByRole('tab',{ name:'display',exact:true }).click();
  await settleRender(page, () => page.locator('#diagnostic').selectOption('transmission'));
  const air = await pixels(page);
  expect(air.min).toBeLessThan(240);
  await settleRender(page, () => page.locator('#atmosphere').uncheck());
  const vacuum = await pixels(page);
  expect(vacuum.min).toBeGreaterThan(253);
  expect(vacuum.mean).toBeGreaterThan(air.mean+3);
  await page.locator('#atmosphere').check();
  await page.locator('#diagnostic').selectOption('natural');
  await settleRender(page, () => page.getByRole('button',{ name:'Axis',exact:true }).click());
  await page.screenshot({ path:'test-results/axis-view.png' });
  await page.getByRole('button',{ name:'Model & assumptions ↗' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Boussinesq');
  await page.getByRole('button',{ name:'Close model notes' }).click();
  expect(errors.get(page)).toEqual([]);
});

// Weather physics is covered by tests/weather.test.ts and live snapshot
// accumulation by workers.spec.ts; this checks settings persistence only.
test('updates the habitat and round-trips an exported experiment', async ({ page }) => {
  await page.goto('/?s='+Buffer.from(JSON.stringify({ quality:'fast',clouds:false,paused:true })).toString('base64'));
  await waitForScene(page);
  await page.getByRole('tab',{ name:'habitat',exact:true }).click();
  await page.locator('#radius').fill('8');
  await expect(page.locator('#radius-value')).toContainText('8 km');
  await expect(page.locator('#rotation')).toContainText('2.99 min');
  await page.getByRole('tab',{ name:'display',exact:true }).click();
  await page.locator('#adaptiveExposure').uncheck();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button',{ name:'Export experiment JSON' }).click();
  const download = await downloadEvent;
  await download.saveAs('test-results/experiment.json');
  const exported = JSON.parse(await readFile('test-results/experiment.json','utf8'));
  expect(exported.radius).toBe(8);
  expect(exported.paused).toBe(true);
  expect(exported.adaptiveExposure).toBe(false);
  await page.getByRole('tab',{ name:'habitat',exact:true }).click();
  await page.locator('#radius').fill('2');
  await page.locator('#pressure').fill('500');
  await page.getByRole('tab',{ name:'display',exact:true }).click();
  await page.locator('#adaptiveExposure').check();
  await page.locator('#import-settings').setInputFiles('test-results/experiment.json');
  await expect(page.locator('#toast')).toContainText('Experiment imported');
  await expect(page.locator('#adaptiveExposure')).not.toBeChecked();
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
  await waitForScene(page);
  await untilRender(page, { mode:'path' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path:'test-results/mobile.png',fullPage:true });
  await page.getByRole('tab',{ name:'light',exact:true }).click();
  await page.locator('#lightMode').selectOption('sun');
  await expect(page.locator('#lightMode')).toHaveValue('sun');
});

test('keeps an unlit habitat dark at the same camera exposure',async({page})=>{
  await page.goto('/?s='+Buffer.from(JSON.stringify({quality:'fast',clouds:false,paused:true,solarPower:0,view:'axis',adaptiveExposure:false})).toString('base64'));
  await waitForScene(page);
  await untilRender(page, { mode:'path' });
  await settleRender(page);
  const dark=await pixels(page);
  expect(dark.mean).toBeLessThan(1);
  await expect(page.locator('#luminance')).toContainText('cd/m²');
});
