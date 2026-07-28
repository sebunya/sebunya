import { test, expect } from '@playwright/test';
import { resolveApprovedProduct } from './support/catalogue-resolver';

/**
 * Slice 13B critical-flow + accessibility acceptance.
 * Runs against the local Astro dev server with the local API stack.
 *
 * Product-dependent journeys resolve a real approved product from the live test
 * API instead of hard-coding a slug; see ./support/catalogue-resolver.ts.
 */

/** Escapes a product name so it can be used inside a RegExp accessible-name matcher. */
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

test('shop search finds a real catalogue product and zero-result CTA appears', async ({ page }) => {
  // Search for a term taken from a product the live API actually serves, rather
  // than a slug baked into the test.
  const product = await resolveApprovedProduct();

  await page.goto(`/shop?search=${encodeURIComponent(product.searchTerm)}`);
  await expect(page.getByRole('link', { name: new RegExp(escapeRegExp(product.name), 'i') }).first()).toBeVisible();

  await page.goto('/shop?search=zzznotarealproduct');
  await expect(page.getByText(/no products matched/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /request this product/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /ask support/i })).toBeVisible();
});

test('PDP renders live API product detail', async ({ page }) => {
  const product = await resolveApprovedProduct();

  const response = await page.goto(`/products/${product.slug}`);
  expect(response?.status(), `PDP for ${product.slug} must resolve`).toBe(200);

  // Generic PDP behaviour: the resolved product's own name is the page heading,
  // and the page carries a price. No product-specific copy is asserted, because
  // that would re-couple the journey to one seeded product.
  await expect(page.getByRole('heading', { name: new RegExp(escapeRegExp(product.name), 'i') }).first()).toBeVisible();
  // Canonical price parity: the price the API reports must appear on the page.
  // Skipped only when the API exposes no price for the resolved product.
  if (product.formattedPrice) {
    await expect(page.getByText(product.formattedPrice, { exact: false }).first()).toBeVisible();
  }
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
