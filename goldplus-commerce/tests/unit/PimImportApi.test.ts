import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "../../packages/shared/src/permissions";
const operations = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  saveMapping: vi.fn(),
  preview: vi.fn(),
  approve: vi.fn(),
  apply: vi.fn(),
  rollback: vi.fn(),
  mappingFields: vi.fn(() => []),
}));
vi.mock("../../apps/api/src/infrastructure/Registry", () => ({
  Registry: { getInstance: () => ({ pimImportOperationsUseCase: operations }) },
}));
vi.mock("../../apps/api/src/interfaces/http/middleware/auth", () => ({
  authMiddleware: async (c: any, next: any) => {
    const auth = c.req.header("Authorization");
    if (!auth) return c.json({ success: false }, 401);
    const map: Record<string, string[]> = {
      read: [PERMISSIONS.PIM_READ],
      map: [PERMISSIONS.PIM_MAP],
      approve: [PERMISSIONS.PIM_APPROVE],
      apply: [PERMISSIONS.PIM_APPLY],
      rollback: [PERMISSIONS.PIM_ROLLBACK],
      all: Object.values(PERMISSIONS),
    };
    c.set("user", {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      permissions: map[auth.replace("Bearer ", "")] ?? [],
    });
    await next();
  },
}));
import app from "../../apps/api/src/interfaces/http/app";
const json = { "Content-Type": "application/json" };
describe("PIM Import protected operating surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    operations.list.mockResolvedValue([]);
    operations.create.mockResolvedValue({});
    operations.apply.mockResolvedValue({});
    operations.approve.mockResolvedValue({});
    operations.rollback.mockResolvedValue({});
  });
  it("requires authentication and exact read permission", async () => {
    expect((await app.request("/admin/pim-imports")).status).toBe(401);
    expect(
      (
        await app.request("/admin/pim-imports", {
          headers: { Authorization: "Bearer forbidden" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request("/admin/pim-imports", {
          headers: { Authorization: "Bearer read" },
        })
      ).status,
    ).toBe(200);
  });
  it("keeps ingestion separately privileged", async () => {
    const body = JSON.stringify({
      name: "Import",
      sourceFilename: "input.json",
      sourceSha256: "a".repeat(64),
      mode: "CREATE_ONLY",
      rows: [{ sku: "ONE" }],
    });
    expect(
      (
        await app.request("/admin/pim-imports", {
          method: "POST",
          headers: { Authorization: "Bearer read", ...json },
          body,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request("/admin/pim-imports", {
          method: "POST",
          headers: { Authorization: "Bearer all", ...json },
          body,
        })
      ).status,
    ).toBe(201);
  });
  it("separates approve, apply and rollback permissions", async () => {
    const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const version = JSON.stringify({ expectedVersion: 1 });
    const approval = JSON.stringify({
      expectedVersion: 1,
      decision: "APPROVED",
      reason: "Independent catalogue review",
    });
    expect(
      (
        await app.request(`/admin/pim-imports/${id}/approval`, {
          method: "POST",
          headers: { Authorization: "Bearer map", ...json },
          body: approval,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(`/admin/pim-imports/${id}/approval`, {
          method: "POST",
          headers: { Authorization: "Bearer approve", ...json },
          body: approval,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/admin/pim-imports/${id}/apply`, {
          method: "POST",
          headers: { Authorization: "Bearer approve", ...json },
          body: version,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(`/admin/pim-imports/${id}/apply`, {
          method: "POST",
          headers: { Authorization: "Bearer apply", ...json },
          body: version,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/admin/pim-imports/${id}/rollback`, {
          method: "POST",
          headers: { Authorization: "Bearer apply", ...json },
          body: JSON.stringify({ expectedVersion: 1, reason: "rollback" }),
        })
      ).status,
    ).toBe(403);
  });
  it("renders the full truthful lifecycle and safety contract", () => {
    const root = path.resolve(
      __dirname,
      "../../apps/web/src/pages/admin/pim-imports",
    );
    const source =
      fs.readFileSync(path.join(root, "index.astro"), "utf8") +
      fs.readFileSync(path.join(root, "[id].astro"), "utf8");
    for (const state of [
      "UPLOADED",
      "MAPPED",
      "READY_FOR_APPROVAL",
      "APPROVED",
      "APPLYING",
      "APPLIED",
      "PARTIALLY_APPLIED",
      "FAILED",
      "ROLLED_BACK",
      "ROLLBACK_PARTIAL",
      "REJECTED",
      "Permission denied",
      "Unavailable",
      "Empty",
      "Stale conflict",
    ])
      expect(source).toContain(state);
    expect(source).toContain(
      "No overwrite without a persisted preview and independent approval",
    );
    expect(source).toContain("fabricated attributes forbidden");
  });
});
