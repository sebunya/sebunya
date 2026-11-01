import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { modelFromUserAgent, plausibleModelCode } from "../../apps/web/src/lib/browsingDevice";

describe("the browsing device is a suggestion, and unknown stays unknown", () => {
  it("reads a model from an unreduced Android user agent", () => {
    expect(modelFromUserAgent("Mozilla/5.0 (Linux; Android 12; TECNO KG5k Build/SP1A.210812.016) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36")).toBe("TECNO KG5k");
    expect(modelFromUserAgent("Mozilla/5.0 (Linux; Android 13; SM-A515F) AppleWebKit/537.36 SamsungBrowser/23.0 Chrome/115 Mobile Safari/537.36")).toBe("SM-A515F");
    expect(modelFromUserAgent("Mozilla/5.0 (Linux; Android 11; Infinix X689B Build/RP1A) AppleWebKit/537.36")).toBe("Infinix X689B");
  });

  it("reduced Chrome, iPhone, Mac, Windows and TVs name no model — nothing is guessed", () => {
    expect(modelFromUserAgent("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36")).toBeNull();
    expect(modelFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1")).toBeNull();
    expect(modelFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15")).toBeNull();
    expect(modelFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36")).toBeNull();
    expect(modelFromUserAgent("Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 Version/6.0 TV Safari/537.36")).toBeNull();
    expect(modelFromUserAgent(null)).toBeNull();
  });

  it("placeholders, empty hints and hostile values are unknown", () => {
    for (const v of ["", "K", "Android", "  ", "<script>alert(1)</script>", "a".repeat(60), "Mobile", "\"onload=x 1"]) {
      expect(plausibleModelCode(v)).toBeNull();
    }
    expect(plausibleModelCode("SM-G991B")).toBe("SM-G991B");
  });

  it("the suggestion is one component, hidden by default, a question, and never a fit claim", () => {
    const c = readFileSync("apps/web/src/components/ThisPhoneSuggestion.astro", "utf8");
    expect(c).toContain("<p data-this-phone hidden");
    expect(c).toContain("choose a different phone");
    expect(c).not.toMatch(/\bfits\b|compatible with your/i);
    expect(c).not.toMatch(/localStorage|cookie|fetch\(/);
    for (const page of ["apps/web/src/pages/battery-finder.astro", "apps/web/src/pages/products/[slug].astro"]) {
      expect(readFileSync(page, "utf8")).toContain("<ThisPhoneSuggestion");
    }
  });

  it("the help route is safe: no opening sealed phones, no IMEI, and an unknown match is not 'no battery exists'", () => {
    const f = readFileSync("apps/web/src/pages/battery-finder.astro", "utf8");
    expect(f).toContain("do not open a sealed phone or remove a swollen or damaged battery");
    expect(f).toContain("we never need your IMEI or serial number");
    const cfg = readFileSync("packages/shared/src/batteries/index.ts", "utf8");
    expect(cfg).toContain("We have not matched a battery to this phone yet");
    expect(cfg).toContain("That does not mean one does not exist");
  });

  it("aftermarket wording: the customer confirms; no OEM/original/guarantee claim and no returns waiver", () => {
    const c = readFileSync("apps/web/src/components/CheckYourPhoneNote.astro", "utf8");
    const copy = c.slice(c.indexOf("<div"));
    expect(copy).toContain("Check your phone before you buy");
    expect(copy).toContain("replacement battery");
    expect(copy).not.toMatch(/\bOEM\b|original|genuine|guarantee|no returns|non-refundable|at your own risk/i);
    expect(copy).not.toMatch(/IMEI|serial/i);
  });
});
