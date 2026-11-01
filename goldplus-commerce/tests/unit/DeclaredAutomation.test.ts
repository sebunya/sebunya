import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isDeclaredAutomation } from "../../apps/web/src/lib/declaredAutomation";

describe("declared automation never records shopper behaviour", () => {
  it("our own probes and self-identifying lab browsers are recognised; shoppers are not", () => {
    const probe = readFileSync("scripts/lighthouse-watch.sh", "utf8").match(/UA_MOBILE="([^"]+)"/)![1];
    expect(isDeclaredAutomation(probe)).toBe(true);
    expect(isDeclaredAutomation("Mozilla/5.0 ... HeadlessChrome/136.0")).toBe(true);
    expect(isDeclaredAutomation("Mozilla/5.0 ... Chrome-Lighthouse")).toBe(true);
    expect(isDeclaredAutomation("Mozilla/5.0 (Linux; Android 13; TECNO KI5q) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36")).toBe(false);
    expect(isDeclaredAutomation("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(isDeclaredAutomation(null)).toBe(false);
  });

  it("every browser event relay checks it before anything is forwarded", () => {
    for (const p of ["apps/web/src/pages/api/rec/[...path].ts", "apps/web/src/pages/api/hero/events.ts", "apps/web/src/pages/api/nav/events.ts"]) {
      const src = readFileSync(p, "utf8");
      const post = src.slice(src.indexOf("export const POST"));
      expect(post.indexOf("isDeclaredAutomation(request.headers)")).toBeGreaterThan(0);
      expect(post.indexOf("isDeclaredAutomation(")).toBeLessThan(post.indexOf("fetch("));
    }
  });

  it("the server-side search event on /shop is guarded too", () => {
    const src = readFileSync("apps/web/src/pages/shop.astro", "utf8");
    expect(src).toContain("if (search && Astro.locals.gpVisit && !isDeclaredAutomation(Astro.request.headers))");
  });

  it("our Playwright audits declare themselves by a first-party cookie and keep their real user agent", () => {
    const shopper = new Headers({ "user-agent": "Mozilla/5.0 (Linux; Android 13; TECNO KI5q) Chrome/126 Mobile Safari/537.36" });
    const audit = new Headers({ "user-agent": shopper.get("user-agent")!, cookie: "gp_visit=abc; gp_probe=compatibility-audit" });
    expect(isDeclaredAutomation(new Headers({ cookie: "not_gp_probe=1; gp_visit=abc" }))).toBe(false);
    expect(isDeclaredAutomation(shopper)).toBe(false);
    expect(isDeclaredAutomation(audit)).toBe(true);
    expect(readFileSync("compatibility-audit/playwright.config.ts", "utf8")).toContain("name: 'gp_probe', value: 'compatibility-audit'");
  });
});
