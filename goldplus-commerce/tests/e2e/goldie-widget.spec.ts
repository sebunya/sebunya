import { test, expect } from '@playwright/test';

/**
 * Goldie, the site's personal shopper, end to end in a real browser: the launcher opens the panel, a starter and a
 * typed question are answered from shop data (CI has no model key, so this is the path every customer gets when
 * the paid layer is off), the answer streams into the log, and nothing on screen says "AI" or "bot".
 */
test('Goldie opens, answers from shop data, and reads as a person', async ({ page }) => {
  await page.goto('/');
  const launch = page.locator('#gp-assistant [data-launch]');
  await expect(launch).toBeVisible();
  await launch.click();
  const panel = page.locator('#gp-assistant-panel');
  await expect(panel).toBeVisible();
  await expect(launch).toHaveAttribute('aria-expanded', 'true');

  const answered = page.waitForResponse((r) => r.url().includes('/api/assistant/chat') && r.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Visit the shop' }).click();
  const res = await answered;
  expect(res.status()).toBe(200);
  expect(res.headers()['x-assistant-route']).not.toBe('ai');
  const log = panel.locator('[data-log]');
  await expect(log).toContainText(/Zainab Aziza/i, { timeout: 20_000 });

  // A typed follow-up goes through the composer.
  const second = page.waitForResponse((r) => r.url().includes('/api/assistant/chat') && r.request().method() === 'POST');
  await panel.locator('[data-input]').fill('Do you deliver to Entebbe?');
  await panel.locator('[data-send]').click();
  expect((await second).status()).toBe(200);
  await expect(log.locator(':scope > *')).not.toHaveCount(0);

  const visible = (await panel.innerText()).toLowerCase();
  expect(visible).not.toMatch(/\bai\b|\bbot\b|chatbot|language model|not a (real )?person/);

  await panel.locator('[data-close]').click();
  await expect(panel).toBeHidden();
});
