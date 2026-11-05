import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findChargers } from "../../apps/web/src/lib/chargerFinder";

/**
 * Brief A1/N3 (2026-11-05): /compare?ids=<GP-W2>,<GP-W3> showed SKU, category and
 * stock and nothing else, with no word that both power banks' ratings are
 * unrecorded; a missing value in a shared row read "N/A" (not applicable).
 */
const compare = readFileSync(join(__dirname, "../../apps/web/src/pages/compare.astro"), "utf8");

describe("compare: unknowns stay explicit", () => {
  it("a missing value is 'Not recorded', never N/A, zero or a sibling's value", () => {
    expect(compare).toContain("item.verifiedSpecs[key] ?? <span");
    expect(compare).toContain(">Not recorded</span>");
    expect(compare).not.toContain(">N/A<");
  });
  it("a product with no checked specification gets its own row saying its ratings are unknown", () => {
    expect(compare).toContain("data-compare-specs-not-recorded");
    expect(compare).toContain("None yet. Capacity, input, output, ports and cables are unknown.");
  });
});

describe("charger finder: a product without a checked spec is not matched, and never ranked as 0 W", () => {
  it("a power bank with no 'Built-in cables' spec is left out rather than guessed", () => {
    const bare = { id: "w2", slug: "goldplus-power-bank-gp-w2-pb", name: "GoldPlus GP-W2 (PD-W2) Power Bank", categoryName: "Power Devices", retailPriceUgx: 110000, availability: { kind: "in_stock" }, verifiedSpecs: {}, attributeValues: [] };
    expect(findChargers([bare as never], { device: "phone", port: "usb-c", need: "powerbank", watts: null })).toEqual([]);
  });
});
