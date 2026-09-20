import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normaliseImportRow, suggestMapping } from "../../apps/api/src/domain/batteries/BatteryImport";
import { normaliseBatteryCode } from "../../apps/api/src/domain/batteries/BatteryCodes";

const FILE = "docs/personalisation/device-compatibility/client-answers-2026-09-20/compatibility-for-admin-import-v3.csv";
const parse = (text: string) => {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else if (ch !== "\r") cell += ch; }
  return rows;
};
const [header, ...body] = parse(readFileSync(FILE, "utf8"));
const mapping = suggestMapping("COMPATIBILITY", header);
const records = body.map((c) => Object.fromEntries(header.map((h, i) => [h, c[i] ?? ""])));
/** An exact-match catalogue, like the real resolver: normalised whole value → one battery. */
const catalogue = (codes: string[], dup: string[] = []) => {
  const idx = new Map<string, string[]>();
  for (const c of [...codes, ...dup]) idx.set(normaliseBatteryCode(c), [...(idx.get(normaliseBatteryCode(c)) ?? []), c]);
  return { resolveBattery: (code: string) => { const l = idx.get(normaliseBatteryCode(code)); return !l ? null : l.length > 1 ? { ambiguous: l } : { productId: "p-" + l[0], canonicalCode: l[0], lifecycle: "REVIEW" }; },
    findClaim: () => null, locationExists: () => true, receiptAlreadyApplied: () => false, currentStock: () => null } as never;
};
const all = catalogue([...new Set(records.map((r) => r["Battery Reference"]))]);
const run = (r: Record<string, string>, ctx = all) => normaliseImportRow("COMPATIBILITY", r, mapping, ctx) as { action: string; errors: string[]; value: { evidenceStatus?: string } | null };

describe("client answers, encoded for the native importer", () => {
  it("every row is a named phone — never 'etc.', never a wildcard", () => {
    for (const r of records) {
      expect(r["Marketing Name"].trim().length).toBeGreaterThan(0);
      expect(r["Marketing Name"]).not.toMatch(/\betc\b|\ball\b|series$|\*/i);
    }
  });

  it("the contradicted client entries are HELD, not staged: Realme 6i, Realme C25, generic Vivo Y55s, ordinary Vivo X20, and the superseded Pop 2 Go", () => {
    const held = records.filter((r) => run(r).action === "HOLD_CONFLICT").map((r) => `${r["Battery Reference"]}|${r["Device Brand"]} ${r["Marketing Name"]}`).sort();
    expect(held).toEqual(["A11/BLP727|Realme 6i", "A11/BLP727|Realme C25", "BL-38BT|TECNO Pop 2 Go", "VIVO B-B1|Vivo Y55s", "VIVO B-D2|Vivo X20"]);
  });

  it("everything else stages as a SUPPLIER-LISTED draft and nothing can arrive verified", () => {
    for (const r of records) { const n = run(r); expect(n.errors, JSON.stringify(r)).toEqual([]); if (n.value) expect(n.value.evidenceStatus).toBe("SUPPLIER_LISTED"); }
  });

  it("hard negatives are absent: no Galaxy A10 and no Galaxy A32 4G anywhere", () => {
    expect(records.some((r) => /^Galaxy A10$/.test(r["Marketing Name"]))).toBe(false);
    expect(records.some((r) => /A32 4G|SM-A325/.test(r["Marketing Name"] + r["Exact Model Number"]))).toBe(false);
  });

  it("B-D2 carries the X20 PLUS family; BL-38BT carries Pop 5 Go", () => {
    const staged = (code: string) => records.filter((r) => r["Battery Reference"] === code && run(r).action === "CREATE_CLAIM").map((r) => r["Marketing Name"]);
    expect(staged("VIVO B-D2")).toEqual(["X20 Plus", "X20 Plus A", "X20 Plus UD"]);
    expect(staged("BL-38BT")).toEqual(["Pop 5 Go"]);
  });
});

describe("battery reference resolution is whole-value and exact", () => {
  const row = (code: string) => ({ ...records[0], "Battery Reference": code });
  it("BL-28AT never resolves to BL-28ATLONG, in either direction", () => {
    expect(run(row("BL-28AT"), catalogue(["BL-28ATLONG"])).errors.join(" ")).toContain("No battery");
    expect(run(row("BL-28ATLONG"), catalogue(["BL-28AT"])).errors.join(" ")).toContain("No battery");
    expect(normaliseBatteryCode("BL-28AT")).not.toBe(normaliseBatteryCode("BL-28ATLONG"));
  });
  it("spaces, case and look-alike hyphens do not change which battery is meant", () => {
    for (const v of ["  bl-28at ", "BL‑28AT", "BL–28AT", "BL 28AT"]) expect(run(row(v), catalogue(["BL-28AT"])).errors).toEqual([]);
  });
  it("an atomic slash code stages; an unknown slash string is held; an ambiguous code is an error, never a first-match guess", () => {
    expect(run(row("A10S/A20S"), catalogue(["A10S/A20S", "A10S"])).action).toBe("CREATE_CLAIM");
    expect(run(row("BL-34DT / BL-30VX"), catalogue(["A10S"])).action).toBe("HOLD_COMPOUND");
    expect(run(row("X1"), catalogue(["X1"], ["X-1"])).errors.join(" ")).toContain("more than one battery");
  });
});
