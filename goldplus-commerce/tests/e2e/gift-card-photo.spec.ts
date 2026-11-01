import { test, expect } from '@playwright/test';
import path from 'node:path';

/**
 * 0201: the optional photo on a gift card, as a buyer meets it on the buy page (the real page, the real API, sharp):
 * choose, place (keyboard), use, keep it across an occasion change and a reload, remove it. The crop geometry itself
 * is unit-tested (tests/unit/PhotoCrop.test.ts); this proves the page, the relay and the API agree.
 */
const PHOTO = path.resolve(__dirname, '../../apps/web/public/hero/ambassador.jpg');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test('a buyer adds a photo, places it, and it stays on the card through an occasion change and a reload', async ({ page }) => {
  await page.goto('/gift-card/buy?theme=birthday');
  await page.locator('[data-photo-add] input[type=file]').setInputFiles(PHOTO);
  await expect(page.locator('[data-photo-crop]')).toBeVisible();
  // The pay bar steps aside while the photo is placed (it would cover the controls).
  await expect(page.locator('[data-pay-bar]')).toHaveAttribute('data-cropping', '');
  await page.locator('[data-photo-frame]').focus();
  for (const key of ['+', '+', 'ArrowLeft', 'ArrowDown']) await page.keyboard.press(key);
  await expect(page.locator('[data-photo-zoom]')).not.toHaveValue('1');
  await page.locator('[data-photo-use]').click();
  await expect(page.locator('[data-photo-chosen]')).toBeVisible();
  const photoId = await page.locator('input[name="photoId"]').inputValue();
  expect(photoId).toMatch(UUID);

  const face = page.locator('[data-gc-preview] [data-gc-face]');
  await expect(face).toHaveClass(/gcf-has-photo/);
  await expect(face).toHaveAttribute('aria-label', /with a photo/);

  // Another occasion keeps the photo.
  await page.locator('label[data-occasion="gold"]').first().click();
  await expect(page.locator('input[name="photoId"]')).toHaveValue(photoId);
  await expect(face).toHaveAttribute('data-theme', 'gold');
  await expect(face).toHaveClass(/gcf-has-photo/);

  // A reload brings it back from the shop (the draft keeps the id, never the picture).
  await page.locator('input[name="recipientName"]').fill('Sarah Nakato');
  await page.waitForTimeout(700);
  await page.goto('/gift-card/buy');
  await expect(page.locator('input[name="photoId"]')).toHaveValue(photoId);
  await expect(page.locator('[data-photo-thumb]')).toHaveAttribute('src', `/gift-card/photo/${photoId}`);
  const served = await page.request.get(`/gift-card/photo/${photoId}`);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toBe('image/jpeg');
  expect(served.headers()['x-robots-tag']).toBe('noindex');

  // Removing it puts the occasion's picture back.
  await page.locator('[data-photo-remove]').click();
  await expect(page.locator('input[name="photoId"]')).toHaveValue('');
  await expect(face).not.toHaveClass(/gcf-has-photo/);
});

test('two fingers pinch to zoom the photo (touch screens)', async ({ page, browserName }, testInfo) => {
  // Real touch input is sent through Chromium's DevTools protocol; the phone project (Pixel 7) runs it in CI.
  test.skip(browserName !== 'chromium' || !testInfo.project.use.hasTouch, 'a pinch needs a touch screen (Chromium)');
  await page.goto('/gift-card/buy?theme=birthday');
  await page.locator('[data-photo-add] input[type=file]').setInputFiles(PHOTO);
  await expect(page.locator('[data-photo-crop]')).toBeVisible();
  await expect(page.locator('[data-photo-zoom]')).toHaveValue('1');
  // Touches land where the screen is: bring the frame into view first (on a phone it can be below the fold).
  await page.locator('[data-photo-frame]').scrollIntoViewIfNeeded();
  const box = (await page.locator('[data-photo-frame]').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const fingers = (apart: number) => [{ x: cx - apart, y: cy, id: 0 }, { x: cx + apart, y: cy, id: 1 }];
  // Real touch input (the same path a phone takes): two fingers down, spreading apart, lifted.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(20) });
  for (const apart of [28, 36, 44, 52]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(apart) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // Fingers 2.6 times further apart: the photo is about 2.6 times closer (the slider follows the pinch).
  await expect.poll(async () => Number(await page.locator('[data-photo-zoom]').inputValue())).toBeGreaterThan(2.2);
});

test('a drawing or animation is refused on the phone with a clear message, and nothing is uploaded', async ({ page }) => {
  let uploads = 0;
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/gift-card/photo')) uploads += 1; });
  await page.goto('/gift-card/buy');
  await page.locator('[data-photo-add] input[type=file]').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"/>') });
  await expect(page.locator('[data-photo-status]')).toContainText('Choose a photo');
  await expect(page.locator('[data-photo-crop]')).toBeHidden();
  expect(uploads).toBe(0);
});

test('without JavaScript the photo box is not offered (it could not work), and the rest of the form is', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/gift-card/buy');
  await expect(page.locator('fieldset[data-photo]')).toBeHidden();
  await expect(page.locator('textarea[name="message"]')).toBeVisible();
  await context.close();
});
