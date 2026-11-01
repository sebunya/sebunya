import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normaliseImportRow, suggestMapping } from "../../apps/api/src/domain/batteries/BatteryImport";

const FILE = "docs/personalisation/device-compatibility/compatibility-map-for-admin-import.csv";
const parseCsv = (text: string) => {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  return rows;
};

describe("the compatibility sheet is ready for the ADMIN importer and can never publish", () => {
  const [header, ...body] = parseCsv(readFileSync(FILE, "utf8"));
  const mapping = suggestMapping("COMPATIBILITY", header);
  const ctx = { resolveBattery: () => ({ productId: "p", canonicalCode: "X", lifecycle: "REVIEW" }), findClaim: () => null, locationExists: () => true, receiptAlreadyApplied: () => false, currentStock: () => null } as never;

  it("every importer field auto-maps from the sheet's own headers", () => {
    for (const key of ["batteryCode", "deviceBrand", "deviceModel", "modelNumber", "evidenceStatus", "evidenceSource", "evidenceUrl", "condition", "claimId", "sourceNo"]) {
      expect(mapping[key], key).toBeTruthy();
    }
  });

  it("all 102 claims are present and none can be staged above SUPPLIER_LISTED", () => {
    expect(body.length).toBe(102);
    for (const cells of body) {
      const source = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
      const r = normaliseImportRow("COMPATIBILITY", source, mapping, ctx) as { value?: { evidenceStatus?: string } | null };
      if (r.value) expect(r.value.evidenceStatus).toBe("SUPPLIER_LISTED");
    }
  });
});
