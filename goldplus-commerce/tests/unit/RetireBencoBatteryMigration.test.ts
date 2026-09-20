import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("0147 retires the Benco battery without destroying history", () => {
  const sql = readFileSync("apps/api/src/infrastructure/db/migrations/0147_retire_benco_23011_battery.sql", "utf8");
  const statements = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  it("hides the product and archives the battery, by SKU/code, idempotently", () => {
    expect(statements).toMatch(/UPDATE "products" SET "active" = false[^;]*WHERE "sku" = 'GP-BAT-BENCO23011' AND "active" = true;/);
    expect(statements).toMatch(/UPDATE "battery_profiles" SET "lifecycle_status" = 'ARCHIVED'[\s\S]*WHERE "canonical_code" = 'BENCO 23011' AND "lifecycle_status" <> 'ARCHIVED';/);
  });
  it("deletes nothing — the stock ledger and import history stay", () => {
    expect(statements).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
  });
  it("is registered in the journal", () => {
    expect(readFileSync("apps/api/src/infrastructure/db/migrations/meta/_journal.json", "utf8")).toContain("0147_retire_benco_23011_battery");
  });
});
