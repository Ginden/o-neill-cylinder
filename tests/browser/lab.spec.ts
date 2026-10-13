import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { canvasPixels as pixels, captureErrors, waitForScene } from './canvas';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { errors.set(page, captureErrors(page)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

async function settleRender(page: Page) {
  const canvas = page.locator('#scene');
  const previous = await canvas.getAttribute('data-samples');
  await expect.poll(() => canvas.getAttribute('data-samples')).not.toBe(previous);
}

test('renders a varied landscape without shader errors and exposes physical comparisons', async ({ page }) => {
  // Fast rendering makes this a shader correctness check even on software graphics.
  await page.goto('/?s='+Buffer.from(JSON.stringify({ quality:'fast',clouds:false,paused:true })).toString('base64'));
  await waitForScene(page);
  await expect(page.locator('#render-state')).toContainText('Path tracing');
  await settleRender(page);
  expect(errors.get(page)).toEqual([]);
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
  // A pending GPU pass keeps the previous frame on screen until it completes.
  await expect.poll(async () => (await pixels(page)).min, { timeout: 20000 }).toBeGreaterThan(253);
  const vacuum = await pixels(page);
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
  expect(errors.get(page)).toEqual([]);
});

test('updates the habitat, evolves weather, and round-trips an exported experiment', async ({ page }) => {
  await page.goto('/?s='+Buffer.from(JSON.stringify({ quality:'fast',timeScale:300,humidity:78,clouds:true })).toString('base64'));
  await waitForScene(page);
  await expect(page.locator('#render-state')).toContainText('Path tracing');
  await page.getByRole('tab',{ name:'weather',exact:true }).click();
  await expect(page.locator('#cloud-fraction')).not.toHaveText('—');
  await expect(page.locator('#sim-time')).not.toHaveText('00:00:00');
  const weatherTime = await page.locator('#sim-time').textContent();
  await expect(page.locator('#render-state')).toContainText('live weather');
  await expect.poll(async () => Number(await page.locator('#scene').getAttribute('data-samples')), { timeout: 20000 }).toBeGreaterThan(8);
  await expect(page.locator('#sim-time')).not.toHaveText(weatherTime!);
  await page.getByRole('button',{ name:'Pause weather',exact:true }).click();
  await settleRender(page);
  await page.screenshot({ path:'test-results/humid-afternoon.png' });
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
  await expect(page.locator('#render-state')).toContainText('Path tracing');
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
  await expect(page.locator('#render-state')).toContainText('Path tracing');
  await settleRender(page);
  const dark=await pixels(page);
  expect(dark.mean).toBeLessThan(1);
  await expect(page.locator('#luminance')).toContainText('cd/m²');
});
