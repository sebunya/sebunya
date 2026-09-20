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

  it("nothing is left on hold, and what the client stated is recorded as they stated it", () => {
    expect(records.filter((r) => run(r).action !== "CREATE_CLAIM")).toEqual([]);
    const row = (code: string, name: RegExp) => records.find((r) => r["Battery Reference"] === code && name.test(r["Marketing Name"]));
    // Client-listed, recorded — each carries a reviewer note because parts catalogues disagree.
    for (const [code, name] of [["A11/BLP727", /^C25$/], ["VIVO B-D2", /^X20$/], ["4UL", /Asha 500/]] as const) {
      expect(row(code, name), `${code}`).toBeTruthy();
      expect(row(code, name)!["Condition / Conflict"]).toMatch(/Reviewer note: .*fit-check/);
    }
    expect(row("4U", /Asha 500/)).toBeTruthy();
    expect(row("BL-38BT", /Pop 2/)).toBeUndefined();       // the client rejected this one
    expect(row("BL-24ET", /Pop 2 Go/)).toBeUndefined();    // trade name of the Pop 2 (B1): an alias, not a second phone
    expect(row("BL-24ET", /^Pop 2$/)).toBeTruthy();
  });

  it("the retired Benco battery is not in the file", () => {
    expect(records.some((r) => /benco/i.test(r["Battery Reference"]))).toBe(false);
  });

  it("the two that were kept are pinned to an exact model so a namesake can never match", () => {
    const row = (code: string, name: string) => records.find((r) => r["Battery Reference"] === code && r["Marketing Name"] === name)!;
    expect(row("VIVO B-B1", "Y55s (2017)")["Exact Model Number"]).toBe("1610");
    expect(row("A11/BLP727", "6i")["Exact Model Number"]).toBe("RMX2040");
    expect(row("A11/BLP727", "6i")["Condition / Conflict"]).toMatch(/NOT the India RMX2002/);
  });

  it("everything else stages as a SUPPLIER-LISTED draft and nothing can arrive verified", () => {
    for (const r of records) { const n = run(r); expect(n.errors, JSON.stringify(r)).toEqual([]); if (n.value) expect(n.value.evidenceStatus).toBe("SUPPLIER_LISTED"); }
  });

  it("hard negatives are absent: no Galaxy A10 and no Galaxy A32 4G anywhere", () => {
    expect(records.some((r) => /^Galaxy A10$/.test(r["Marketing Name"]))).toBe(false);
    expect(records.some((r) => /A32 4G|SM-A325/.test(r["Marketing Name"] + r["Exact Model Number"]))).toBe(false);
  });

  it("B-D2 carries the X20 PLUS family; BL-38BT carries Pop 5 Go + Pop 6 Go; the Pop 2 family stays on BL-24ET", () => {
    const staged = (code: string) => records.filter((r) => r["Battery Reference"] === code && run(r).action === "CREATE_CLAIM").map((r) => r["Marketing Name"]);
    expect(staged("VIVO B-D2")).toEqual(["X20 Plus", "X20 Plus A", "X20 Plus UD", "X20"]);
    expect(staged("BL-38BT")).toEqual(["Pop 5 Go", "Pop 6 Go"]);
    expect(staged("BL-24ET")).toEqual(["Pop 1", "Pop 2", "Pop 2F"]);
  });
});

describe("one phone, one identity, one pack", () => {
  const key = (r: Record<string, string>) => `${r["Device Brand"]}|${r["Marketing Name"]}`.toLowerCase().replace(/[^a-z0-9|]/g, "");
  it("a phone never appears with two different model-number cells (that would create duplicate phone records)", () => {
    const seen = new Map<string, Set<string>>();
    for (const r of records) seen.set(key(r), (seen.get(key(r)) ?? new Set()).add(r["Exact Model Number"]));
    expect([...seen].filter(([, v]) => v.size > 1).map(([k]) => k)).toEqual([]);
  });
  it("a phone is STAGED on two batteries only where the client put it on both (A10S = A10S/A20S; Pop 6 Go; Asha 500)", () => {
    const packs = new Map<string, Set<string>>();
    for (const r of records) if (run(r).action === "CREATE_CLAIM") packs.set(key(r), (packs.get(key(r)) ?? new Set()).add(r["Battery Reference"]));
    const multi = [...packs].filter(([, v]) => v.size > 1).map(([k, v]) => `${k}:${[...v].sort().join("+")}`).sort();
    expect(multi).toEqual(["nokia|asha500:4U+4UL", "samsung|galaxya10s:A10S+A10S/A20S", "samsung|galaxya20s:A10S+A10S/A20S", "tecno|pop6go:BL-38BT+BL-38CT"]);
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
