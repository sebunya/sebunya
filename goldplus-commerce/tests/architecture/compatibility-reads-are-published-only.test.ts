import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A staged compatibility import is DRAFT + SUPPLIER_LISTED. The battery finder
 * derives what a customer sees through publicFitState; the older device
 * repository read the same table with no publication filter at all, so the
 * first caller would have shown every staged supplier claim as a fit.
 */
describe("customer-facing compatibility reads see published fits only", () => {
  const src = readFileSync("apps/api/src/infrastructure/db/repositories/DrizzleDeviceRepository.ts", "utf8");

  it("both reads apply the publication predicate", () => {
    const body = (name: string) => src.slice(src.indexOf(`async ${name}(`), src.indexOf("\n  }\n", src.indexOf(`async ${name}(`)));
    expect(body("compatibleProducts")).toContain("PUBLISHED_FIT");
    expect(body("accessorySuggestions")).toContain("PUBLISHED_FIT");
  });

  it("the predicate requires publication, checked evidence and an active battery", () => {
    const p = src.slice(src.indexOf("const PUBLISHED_FIT"), src.indexOf("export class"));
    expect(p).toContain("= 'ACTIVE'");
    expect(p).not.toContain("SUPPLIER_LISTED");
    expect(p).not.toContain("REJECTED'");
    expect(p).toContain("bp.lifecycle_status <> 'ACTIVE'");
  });
});
