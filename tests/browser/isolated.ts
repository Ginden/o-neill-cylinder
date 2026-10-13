import type {Page} from '@playwright/test';

/** Controlled GPU checks must not run the app's animation loop or be reloaded
 * by Vite while asynchronously importing and compiling their test shaders. */
export async function openIsolatedPage(page:Page) {
  await page.route(/\/(?:src\/main\.ts(?:\?.*)?|@vite\/client)$/,route=>
    route.fulfill({contentType:'application/javascript',body:''}));
  await page.goto('/');
}
