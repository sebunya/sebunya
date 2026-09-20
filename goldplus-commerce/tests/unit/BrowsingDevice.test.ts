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
});
