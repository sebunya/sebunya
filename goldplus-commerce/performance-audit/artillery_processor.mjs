// Artillery Playwright journey: homepage → product → add to cart → cart →
// checkout ENTRY. Stops before payment: no payment method, no order.
// Reads AUDIT_PRODUCT_URL; without it the journey stops at the shop page.
export async function journey(page, vuContext, events, test) {
  const base = (process.env.LOAD_TARGET_URL || '').replace(/\/+$/, '');
  const product = process.env.AUDIT_PRODUCT_URL || '';
  await test.step('homepage', async () => { await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' }); });
  await test.step('shop', async () => { await page.goto(`${base}/shop`, { waitUntil: 'domcontentloaded' }); });
  if (product) {
    await test.step('product', async () => { await page.goto(product, { waitUntil: 'domcontentloaded' }); });
    await test.step('add_to_cart', async () => {
      // The product page's add-to-cart form (action="/cart", hidden action=add): a cart line, never an order.
      const form = page.locator('form[action="/cart"]').first();
      if (await form.count()) await Promise.all([page.waitForLoadState('domcontentloaded'), form.locator('button[type="submit"]').first().click()]);
    });
    await test.step('cart', async () => { await page.goto(`${base}/cart`, { waitUntil: 'domcontentloaded' }); });
    await test.step('checkout_entry', async () => { await page.goto(`${base}/checkout`, { waitUntil: 'domcontentloaded' }); /* STOP before payment */ });
  }
}
