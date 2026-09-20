import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateCompatibilityImport } from "../../apps/api/src/domain/products/DeviceCompatibilityImport";
import { deviceSlug } from "../../apps/api/src/domain/products/Devices";

const DIR = "docs/personalisation/device-compatibility/";
const parse = (file: string) => {
  const [head, ...lines] = readFileSync(DIR + file, "utf8").trim().split(/\r?\n/);
  const cols = head.split(",");
  return lines.map((l) => Object.fromEntries(l.split(",").map((c, i) => [cols[i], c])) as Record<string, string>);
};

describe("the proposed device-compatibility import is loadable and claims no more than its evidence", () => {
  const devices = parse("proposed-devices.csv");
  const claims = parse("proposed-compatibility.csv");

  it("passes the importer's own whole-file validation", () => {
    const result = validateCompatibilityImport(claims as never);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("every claim points at a device in the device file, by the slug the system will compute", () => {
    const slugs = new Set(devices.map((d) => deviceSlug(d.brand, d.model)));
    for (const d of devices) expect(d.slug).toBe(deviceSlug(d.brand, d.model));
    for (const c of claims) expect(slugs.has(c.deviceRef)).toBe(true);
  });

  it("nothing is marked verified: a supplier's cross-check is a declaration, and each row names its source", () => {
    for (const c of claims) {
      expect(c.confidence).toBe("declared");
      expect(c.evidenceSource.startsWith("Supplier cross-check:")).toBe(true);
    }
  });

  it("no duplicate claim", () => {
    const keys = claims.map((c) => `${c.productRef}|${c.deviceRef}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
