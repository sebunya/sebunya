import { test, expect, type Page } from '@playwright/test';

/**
 * Control Centre and Commerce OS admin UAT.
 *
 * Runs against exact API and web images during Mac Rail B validation. It asserts
 * the operational truths this programme delivered, not cosmetics:
 *   - both surfaces render from computed readiness
 *   - the three axes are separate, so PROTECTED never reads as broken
 *   - no forbidden copy survives anywhere in the admin UI
 *   - every card's primary link resolves
 *   - an unauthorised role gets a precise denial, not a fake green card
 *
 * Requires ADMIN_EMAIL / ADMIN_PASSWORD for an administrator, and optionally
 * READONLY_EMAIL / READONLY_PASSWORD for the unauthorised-role check.
 */

const FORBIDDEN_COPY = [
  'API UNAVAILABLE',
  'API unavailable',
  'COMING SOON',
  'Coming soon',
  'NEEDS CONFIGURATION',
  'Needs configuration',
  'Live action: blocked',
];

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/admin/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/admin(?!\/login)/, { timeout: 30_000 });
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

test.describe('Control Centre', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'ADMIN_EMAIL/ADMIN_PASSWORD required');

  test('renders every Trust Centre module from computed readiness', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto('/admin');

    // A readiness failure must never be papered over with static cards.
    await expect(page.locator('[data-cc-failure]')).toHaveCount(0);

    const cards = page.locator('[data-cc-module]');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(7);

    // Every card carries three independent axes.
    for (const card of await cards.all()) {
      await expect(card.locator('[data-cc-service]')).toBeVisible();
      await expect(card.locator('[data-cc-access]')).toBeVisible();
      await expect(card.locator('[data-cc-activation]')).toBeVisible();
    }

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('shows Orders and Measurement as LIVE and PROTECTED', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto('/admin');

    for (const key of ['orders', 'measurement']) {
      const card = page.locator(`[data-cc-module="${key}"]`);
      await expect(card, `${key} card must render`).toBeVisible();
      await expect(card).toHaveAttribute('data-service-status', 'LIVE');
      await expect(card).toHaveAttribute('data-access-status', 'PROTECTED');
    }
  });

  test('shows Loyalty as live but dormant until approved', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto('/admin');
    const card = page.locator('[data-cc-module="loyalty"]');
    await expect(card).toHaveAttribute('data-service-status', 'LIVE');
    await expect(card).toHaveAttribute('data-activation-status', /DORMANT|ACTIVE/);
  });

  test('readiness refresh works', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto('/admin');
    await page.locator('[data-cc-refresh]').click();
    await expect(page.locator('[data-cc-module]').first()).toBeVisible();
    await expect(page.locator('[data-cc-failure]')).toHaveCount(0);
  });
});

test.describe('Commerce OS', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'ADMIN_EMAIL/ADMIN_PASSWORD required');

  test('renders all fourteen commerce modules', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto('/admin/commerce-os');

    await expect(page.locator('[data-commerce-os]')).toBeVisible();
    await expect(page.locator('[data-cc-failure]')).toHaveCount(0);
    await expect(page.locator('[data-cc-module]')).toHaveCount(14);

    for (const key of [
      'decision-intelligence', 'customer-dna', 'shopping-assistant', 'automation',
      'surveys', 'copy-quality', 'behavioural-interventions', 'experiments',
      'pricing', 'fraud', 'pim-import', 'loyalty-os', 'search-insights',
      'inventory-fulfilment',
    ]) {
      await expect(page.locator(`[data-cc-module="${key}"]`), `${key} must render`).toBeVisible();
    }

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('every primary action resolves to a real page', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto('/admin/commerce-os');

    const targets = await page.locator('[data-cc-primary-action]').evaluateAll((els) =>
      els.map((el) => (el as HTMLAnchorElement).getAttribute('href')).filter(Boolean),
    );
    expect(targets.length).toBeGreaterThan(0);

    for (const href of targets) {
      const response = await page.goto(href as string);
      expect(response?.status(), `${href} must not 404`).toBeLessThan(400);
      // A module page that renders is not enough — it must not be an error page.
      await expect(page.locator('text=/internal server error/i')).toHaveCount(0);
      await page.goBack();
    }
  });
});

test.describe('forbidden copy', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'ADMIN_EMAIL/ADMIN_PASSWORD required');

  test('no admin surface renders overloaded status copy', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);

    for (const route of ['/admin', '/admin/commerce-os', '/admin/support', '/admin/loyalty']) {
      await page.goto(route);
      const text = await page.locator('body').innerText();
      for (const phrase of FORBIDDEN_COPY) {
        expect(text, `${route} must not render "${phrase}"`).not.toContain(phrase);
      }
    }
  });
});

test.describe('support and loyalty are reachable', () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, 'ADMIN_EMAIL/ADMIN_PASSWORD required');

  test('the Support card opens the real inbox', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto('/admin');
    await page.locator('[data-cc-module="support"] [data-cc-primary-action]').click();
    await expect(page).toHaveURL(/\/admin\/support/);
    // A truthful empty state is acceptable; an error page is not.
    await expect(page.locator('text=/internal server error/i')).toHaveCount(0);
  });

  test('the Loyalty card opens the operating foundation', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto('/admin');
    await page.locator('[data-cc-module="loyalty"] [data-cc-primary-action]').click();
    await expect(page).toHaveURL(/\/admin\/loyalty/);
  });
});

test.describe('unauthorised role', () => {
  const RO_EMAIL = process.env.READONLY_EMAIL;
  const RO_PASSWORD = process.env.READONLY_PASSWORD;
  test.skip(!RO_EMAIL || !RO_PASSWORD, 'READONLY_EMAIL/READONLY_PASSWORD required');

  test('sees a precise denial rather than a fabricated healthy card', async ({ page }) => {
    await signIn(page, RO_EMAIL!, RO_PASSWORD!);
    await page.goto('/admin');

    const failure = page.locator('[data-cc-failure]');
    const noAction = page.locator('[data-cc-no-action]');
    // Either the whole surface is refused, or individual cards state the missing
    // permission. What must never happen is a green card the role cannot use.
    expect((await failure.count()) + (await noAction.count())).toBeGreaterThan(0);

    if (await failure.count()) {
      await expect(failure.locator('[data-cc-failure-reason]')).toContainText(/FORBIDDEN|UNAUTHENTICATED/);
    }
  });
});
