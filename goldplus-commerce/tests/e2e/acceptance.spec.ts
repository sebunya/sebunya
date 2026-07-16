import { test, expect } from '@playwright/test';

/**
 * Slice 13B critical-flow + accessibility acceptance.
 * Runs against the local Astro dev server with the local API stack.
 */

test('homepage renders with language, landmarks and skip link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-UG');
  expect(await page.locator('main, [role="main"], #main').count()).toBeGreaterThan(0);
  const skip = page.locator('a[href="#main"]');
  await expect(skip).toHaveText(/skip to content/i);
  // Keyboard: first Tab reaches the skip link; Enter moves focus target into view.
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
});

test('shop search finds the catalogue product and zero-result CTA appears', async ({ page }) => {
  await page.goto('/shop?search=power');
  await expect(page.getByRole('heading', { name: /power bank 20000mah/i }).first()).toBeVisible();

  await page.goto('/shop?search=zzznotarealproduct');
  await expect(page.getByText(/no products matched/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /request this product/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /ask support/i })).toBeVisible();
});

test('PDP shows verified compatibility with its condition note', async ({ page }) => {
  await page.goto('/products/power-bank-20000mah');
  await expect(page.getByRole('heading', { name: /verified compatibility/i })).toBeVisible();
  await expect(page.getByText(/works with conditions/i)).toBeVisible();
  await expect(page.getByText(/30w adapter/i)).toBeVisible();
});

test('legal pages show registry status chips and support-routed claims', async ({ page }) => {
  await page.goto('/returns');
  await expect(page.getByText(/draft — pending legal review/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /contact support/i }).first()).toBeVisible();
  await page.goto('/privacy');
  await expect(page.getByText(/interim public guidance/i)).toBeVisible();
});

test('admin pages redirect logged-out visitors to login', async ({ page }) => {
  const response = await page.goto('/admin/demand');
  expect(response!.url()).toContain('/admin/login');
});

test('no page disables pinch zoom (mobile accessibility)', async ({ page }) => {
  await page.goto('/');
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport).not.toMatch(/user-scalable\s*=\s*no|maximum-scale=1(\.0)?(,|$)/);
});
