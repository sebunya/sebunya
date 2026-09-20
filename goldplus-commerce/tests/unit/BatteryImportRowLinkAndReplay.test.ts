import { describe, expect, it } from "vitest";
import { normaliseImportRow, suggestMapping } from "../../apps/api/src/domain/batteries/BatteryImport";
import { BatteryImportUseCases } from "../../apps/api/src/application/use-cases/batteries/BatteryImportUseCases";

const cols = ["Claim ID", "Battery Reference", "Device Brand", "Marketing Name", "Exact Model Number", "Evidence Status", "Evidence Source"];
const mapping = suggestMapping("COMPATIBILITY", cols);
const iphone = { "Claim ID": "1", "Battery Reference": "", "Device Brand": "Apple", "Marketing Name": "iPhone X", "Exact Model Number": "Regional A-number pending", "Evidence Status": "Inventory-name claim", "Evidence Source": "BATTERIES (2).xlsx" };
const ctx = (claim: { id: string; workflowStatus: string } | null = null) => ({
  resolveBattery: (code: string) => (code.replace(/\s/g, "").toUpperCase() === "IPX" ? { productId: "p-ipx", canonicalCode: "IP X", lifecycle: "REVIEW" } : null),
  findClaim: () => claim, locationExists: () => true, receiptAlreadyApplied: () => false, currentStock: () => null,
}) as never;

describe("a research row with no battery code can be linked to a catalogue battery", () => {
  it("unlinked: the row cannot stage, and says why", () => {
    const r = normaliseImportRow("COMPATIBILITY", iphone, mapping, ctx());
    expect(r.errors).toContain("Battery code is required.");
  });

  it("linked: it stages as a SUPPLIER-LISTED draft claim — identity only, never evidence", () => {
    const effective = { ...iphone, [mapping.batteryCode]: "IP X" };
    const r = normaliseImportRow("COMPATIBILITY", effective, mapping, ctx()) as { errors: string[]; action: string; value: { batteryProductId: string; evidenceStatus: string } };
    expect(r.errors).toEqual([]);
    expect(r.action).toBe("CREATE_CLAIM");
    expect(r.value.batteryProductId).toBe("p-ipx");
    expect(r.value.evidenceStatus).toBe("SUPPLIER_LISTED");
    expect(iphone["Battery Reference"]).toBe(""); // what the research said is untouched
  });

  it("a fit a person withdrew is not brought back by replaying the research", () => {
    const effective = { ...iphone, [mapping.batteryCode]: "IP X" };
    const r = normaliseImportRow("COMPATIBILITY", effective, mapping, ctx({ id: "c1", workflowStatus: "ARCHIVED" })) as { action: string; warnings: string[] };
    expect(r.action).toBe("SKIP_CLAIM");
    expect(r.warnings.join(" ")).toContain("withdrawn by a person");
  });
});

describe("linkRowBattery — server-side rules", () => {
  const session = (over: Record<string, unknown> = {}) => ({ id: "s", importType: "COMPATIBILITY", status: "READY_FOR_APPROVAL", mapping, version: 3, ...over });
  const make = (s: Record<string, unknown>, known = true) => {
    const calls: unknown[][] = [];
    const repo = { find: async () => s, linkRowBattery: async (...a: unknown[]) => { calls.push(a); return { session: s, row: {} }; } };
    const uc = Object.create(BatteryImportUseCases.prototype) as BatteryImportUseCases & Record<string, unknown>;
    (uc as Record<string, unknown>).repo = repo;
    (uc as Record<string, unknown>).catalogueContext = async () => ({ preload: async () => undefined, resolveBattery: (c: string) => (known && /ip\s*x/i.test(c) ? { productId: "p", canonicalCode: "IP X", lifecycle: "REVIEW" } : null) });
    return { uc, calls };
  };

  it("stores the catalogue's own spelling of the code and the reason", async () => {
    const { uc, calls } = make(session());
    await uc.linkRowBattery({ id: "s", rowId: "r", canonicalCode: "ip x", note: "The IP X battery is the iPhone X battery", actorId: "a" });
    expect(calls[0].slice(2, 4)).toEqual(["IP X", "The IP X battery is the iPhone X battery"]);
  });

  it("refuses a battery that does not exist, a missing reason, other import types and approved imports", async () => {
    await expect(make(session(), false).uc.linkRowBattery({ id: "s", rowId: "r", canonicalCode: "NOPE", note: "because", actorId: "a" })).rejects.toThrow(/no battery/i);
    await expect(make(session()).uc.linkRowBattery({ id: "s", rowId: "r", canonicalCode: "IP X", note: "  ", actorId: "a" })).rejects.toThrow();
    await expect(make(session({ importType: "PRICE_UPDATE" })).uc.linkRowBattery({ id: "s", rowId: "r", canonicalCode: "IP X", note: "because", actorId: "a" })).rejects.toThrow(/compatibility/i);
    await expect(make(session({ status: "APPROVED" })).uc.linkRowBattery({ id: "s", rowId: "r", canonicalCode: "IP X", note: "because", actorId: "a" })).rejects.toThrow(/before approval/i);
  });
});

describe("a catalogue code that contains a slash is one battery, not a compound line", () => {
  const cols2 = ["Battery Reference", "Device Brand", "Marketing Name", "Evidence Status", "Evidence Source"];
  const map2 = suggestMapping("COMPATIBILITY", cols2);
  const cat = (known: string[]) => ({
    resolveBattery: (c: string) => (known.includes(c) ? { productId: "p-" + c, canonicalCode: c, lifecycle: "REVIEW" } : null),
    findClaim: () => null, locationExists: () => true, receiptAlreadyApplied: () => false, currentStock: () => null,
  }) as never;
  const row = (code: string) => ({ "Battery Reference": code, "Device Brand": "Samsung", "Marketing Name": "Galaxy A20", "Evidence Status": "Supplier claim", "Evidence Source": "client list" });

  it("'A20/A30/A50' exists in the catalogue → a claim can be staged on it", () => {
    const r = normaliseImportRow("COMPATIBILITY", row("A20/A30/A50"), map2, cat(["A20/A30/A50"])) as { action: string; errors: string[] };
    expect(r.errors).toEqual([]);
    expect(r.action).toBe("CREATE_CLAIM");
  });

  it("a slash reference that names NO single battery is still held for splitting", () => {
    const r = normaliseImportRow("COMPATIBILITY", row("BL-38CT / BL-38CI"), map2, cat(["A20/A30/A50"])) as { action: string };
    expect(r.action).toBe("HOLD_COMPOUND");
  });
});
