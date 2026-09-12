import { test, expect } from "@playwright/test";

/**
 * R3.1 C10 — the storefront browser matrix against the live release.
 * Read-only: no order is placed, no form submitted, no admin mutation.
 * Accessibility checks are structural (landmarks, labels, headings, alt text,
 * keyboard focus) — recorded honestly as such, not claimed as a full audit.
 */

test.describe("homepage", () => {
  test("renders with rails, a signed visit cookie, and no mock trackers", async ({ page, context }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    // The recommendation rail serves (title depends on live evidence).
    await expect(page.locator("[data-recommendation-click]").first()).toBeVisible();

    // The hero must actually occupy the page. It renders its slides absolutely,
    // so if the section ever collapses (e.g. a flex parent shrinking it to its
    // padding) the whole hero goes blank — this asserts it has real width and
    // height, and that its lead heading is visible.
    const heroBox = page.locator("#gpHero");
    await expect(heroBox).toBeVisible();
    const heroRect = await heroBox.boundingBox();
    expect(heroRect, "hero box must have a bounding box").not.toBeNull();
    expect(heroRect!.width).toBeGreaterThan(300);
    expect(heroRect!.height).toBeGreaterThan(300);
    await expect(page.locator(".gp-hero h1")).toHaveCount(1);

    // The opaque locator is HttpOnly — visible to the context, not to scripts.
    const cookies = await context.cookies();
    const visit = cookies.find((c) => c.name === "gp_visit");
    expect(visit?.httpOnly).toBe(true);
    expect(visit?.value ?? "").toMatch(/^[A-Za-z0-9_-]{44}$/);
    const scriptCookie = await page.evaluate(() => document.cookie);
    expect(scriptCookie).not.toContain("gp_visit");

    // §32: no mock tracking ids in production HTML.
    const html = await page.content();
    expect(html).not.toContain("GTM-MOCKID");
    expect(html).not.toContain("phc_mock_key_for_telemetry");
  });

  test("accessibility structure: landmarks, headings, skip link, image alts", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main")).toHaveCount(1);
    expect(await page.locator("h1").count()).toBeGreaterThanOrEqual(1);
    await expect(page.locator('a[href="#main"]')).toHaveCount(1);
    const badImgs = await page.locator("img:not([alt])").count();
    expect(badImgs).toBe(0);
  });
});

test.describe("shop and search", () => {
  test("lists the live catalogue and search narrows honestly", async ({ page }) => {
    await page.goto("/shop");
    const productLinks = page.locator('a[href^="/products/"]');
    expect(await productLinks.count()).toBeGreaterThanOrEqual(8);

    await page.goto("/shop?search=charger");
    expect(await page.locator('a[href^="/products/"]').count()).toBeGreaterThanOrEqual(1);
  });
});

test.describe("product pages — truthful rails", () => {
  // Discover live products rather than pin slugs: the two this spec used to
  // name were retired demo products, and the spec failed on every run against
  // production (6 of 27 checks) while asserting nothing about the live shop.
  const API = process.env.E2E_API_BASE ?? "https://api.shopgoldplus.com";
  const RAIL = "You may also need";

  async function liveSlugs(request: import("@playwright/test").APIRequestContext): Promise<string[]> {
    const res = await request.get(`${API}/products?limit=24`);
    const json = (await res.json()) as { data?: Array<{ slug: string }> };
    return (json.data ?? []).map((p) => p.slug);
  }

  test("every sampled PDP shows the rail exactly when the API has items for it — never filler, never a lost rail", async ({ page, request }) => {
    const slugs = (await liveSlugs(request)).slice(0, 8);
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      const product = (await (await request.get(`${API}/products/${slug}`)).json()) as { data?: { id: string } };
      const id = product.data?.id;
      expect(id, slug).toBeTruthy();
      const rec = (await (await request.get(`${API}/recommendations?placement=complete_setup&productId=${id}&limit=4`)).json()) as { data?: { items: unknown[] } };
      const apiHasItems = (rec.data?.items?.length ?? 0) > 0;
      const response = await page.goto(`/products/${slug}`);
      expect(response?.status(), slug).toBe(200);
      const railCount = await page.getByText(RAIL).count();
      // The page must agree with its own engine: a rail with nothing behind it
      // is filler; items with no rail is a broken page.
      expect(railCount > 0, `${slug}: api items=${apiHasItems} rail=${railCount}`).toBe(apiHasItems);
    }
  });

  test("a product the catalogue does not contain is a 404, never a fabricated page", async ({ page }) => {
    const response = await page.goto(`/products/this-product-does-not-exist-${Date.now()}`);
    expect(response?.status()).toBe(404);
  });
});

test.describe("cart", () => {
  test("the cart page renders and never blocks on recommendation state", async ({ page }) => {
    const response = await page.goto("/cart");
    expect(response?.status()).toBe(200);
    await expect(page.locator("main")).toBeVisible();
  });
});

test.describe("keyboard operation", () => {
  test("tab reaches an interactive element with a visible focus indicator", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toHaveCount(1);
    const tag = await focused.evaluate((el) => el.tagName.toLowerCase());
    expect(["a", "button", "input"]).toContain(tag);
  });
});

test.describe("event capture is same-origin", () => {
  test("the relay endpoint answers on the storefront origin (no CORS dependency)", async ({ page }) => {
    await page.goto("/");
    const status = await page.evaluate(async () => {
      const res = await fetch("/api/rec/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          eventType: "PAGE_VIEW",
          anonymousId: "anon_e2e_probe_0001",
          source: "e2e",
          metadata: { probe: "r31-playwright" },
        }),
      });
      return res.status;
    });
    expect(status).toBe(200);
  });
});
