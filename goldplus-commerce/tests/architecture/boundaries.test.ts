import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function readFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".astro", ".turbo"].includes(entry.name)) return [];
      return readFiles(fullPath);
    }

    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) return [];
    return [fullPath];
  });
}

describe("Architecture boundaries", () => {
  it("domain files must not import framework, database, or external adapter code", () => {
    const domainDir = path.join(root, "apps/api/src/domain");
    const files = readFiles(domainDir);

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");

      expect(content, `${file} must not import Hono`).not.toMatch(/from\s+["']hono["']/);
      expect(content, `${file} must not import Drizzle`).not.toMatch(/from\s+["']drizzle-orm/);
      expect(content, `${file} must not import notification adapters`).not.toMatch(/infrastructure\/notifications/);
      expect(content, `${file} must not import HTTP routes`).not.toMatch(/interfaces\/http/);
    }
  });

  it("HTTP routes must not import repositories directly", () => {
    const routesDir = path.join(root, "apps/api/src/interfaces/http/routes");
    const files = readFiles(routesDir);

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      expect(content, `${file} must call use cases, not repositories directly`).not.toMatch(/repositories\//);
      expect(content, `${file} must not import database schema directly`).not.toMatch(/db\/schema/);
    }
  });

  it("Application layer must not import Infrastructure layer", () => {
    const applicationDir = path.join(root, "apps/api/src/application");
    const files = readFiles(applicationDir);

    for (const file of files) {
      // Skip explicitly identified leaks documented for refactoring or requiring direct transaction ORM bounds
      if (
        file.includes("DealerApplicationUseCase.ts") ||
        file.includes("VerificationCheckUseCase.ts") ||
        file.includes("TrackBrowserTelemetryEventUseCase.ts") ||
        file.includes("StitchBrowserIdentityUseCase.ts")
      ) {
        continue;
      }

      const content = fs.readFileSync(file, "utf8");
      // Exception: Type references are strictly forbidden, enforces pure port-based architecture.
      expect(content, `${file} must not import infrastructure adapters`).not.toMatch(/from\s+["'](.*)infrastructure\//);
    }
  });

  it("admin route files must import auth + requirePermissions", () => {
    const adminRoutesDir = path.join(root, "apps/api/src/interfaces/http/routes/admin");
    if (!fs.existsSync(adminRoutesDir)) {
      return; // Vacuously satisfied
    }
    const files = readFiles(adminRoutesDir).filter((f) => f.endsWith(".ts"));

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      const hasAuth = /from\s+["'][^"']*\/middleware\/auth["']/.test(content);
      const hasPerms = /requirePermissions\s*\(/.test(content);

      expect(hasAuth, `${file} must import authMiddleware from middleware/auth`).toBe(true);
      expect(hasPerms, `${file} must call requirePermissions(...) on each handler`).toBe(true);
    }
  });

  it("admin and governance write routes must call CreateAuditLogUseCase", () => {
    const candidateFiles: string[] = [];

    const governance = path.join(root, "apps/api/src/interfaces/http/routes/governance.ts");
    if (fs.existsSync(governance)) candidateFiles.push(governance);

    const adminDir = path.join(root, "apps/api/src/interfaces/http/routes/admin");
    if (fs.existsSync(adminDir)) {
      candidateFiles.push(...readFiles(adminDir).filter((f) => f.endsWith(".ts")));
    }

    // Per HANDLER, not per file (review 2026-11): one audited handler, or the
    // word in a comment, used to clear every other write handler in the file.
    // A handler is audited when its own body audits, or calls a helper in the
    // same file that does. A file-wide "audit-exempt: <reason>" marker (line
    // or block comment) still covers a file whose use cases audit internally.
    const auditRegex = /\bauditUc\.execute\s*\(|CreateAuditLogUseCase|createAuditLogUseCase/;
    const exemptionMarker = /(\/\/|^\s*\*)\s*audit-exempt:/m;
    const anyRoute = /\b(?:routes|app)\.(get|post|put|patch|delete|all|on|use|route)\s*\(\s*(['"`][^'"`]*['"`])?/g;
    const unaudited: string[] = [];

    for (const file of candidateFiles) {
      const content = fs.readFileSync(file, "utf8");
      if (exemptionMarker.test(content)) continue;
      const helpers: string[] = [];
      for (const h of content.matchAll(/(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\()/g)) {
        const rest = content.slice(h.index!);
        const end = rest.slice(1).search(/\n(?:function|const|routes\.|app\.|export)/);
        if (auditRegex.test(end < 0 ? rest : rest.slice(0, end + 1))) helpers.push((h[1] || h[2])!);
      }
      const matches = [...content.matchAll(anyRoute)];
      matches.forEach((m, i) => {
        if (!/^(post|put|patch|delete)$/.test(m[1]!)) return;
        const handler = content.slice(m.index!, i + 1 < matches.length ? matches[i + 1]!.index! : content.length);
        if (auditRegex.test(handler)) return;
        if (helpers.some((n) => new RegExp(`\\b${n}\\s*\\(`).test(handler))) return;
        const rel = path.relative(root, file).split(path.sep).join("/");
        unaudited.push(`${rel} ${m[1]!.toUpperCase()} ${(m[2] ?? "?").slice(1, -1)}`);
      });
    }

    // Write handlers found unaudited when the detector went per-handler
    // (2026-11). Listed, NOT fixed: several files say in a header comment that
    // their use cases audit, and some are read-only POSTs (preview/validate).
    // Each needs a decision. The list may only shrink: a NEW unaudited write
    // handler fails here.
    const known = new Set(KNOWN_UNAUDITED_WRITE_HANDLERS);
    const added = unaudited.filter((k) => !known.has(k));
    expect(
      added,
      `write handlers that never call CreateAuditLogUseCase. Either add audit, or add a ` +
        `"// audit-exempt: <reason>" comment for a file whose writes have a dedicated audit channel.`,
    ).toEqual([]);
  });
});


// Recorded 2026-11 when the audit detector went per-handler. See the test above.
const KNOWN_UNAUDITED_WRITE_HANDLERS: string[] = [
  "apps/api/src/interfaces/http/routes/governance.ts POST /verification/check",
  "apps/api/src/interfaces/http/routes/admin/advertising.ts PUT /:platform",
  "apps/api/src/interfaces/http/routes/admin/advertising.ts PUT /capabilities/:platform/:capability",
  "apps/api/src/interfaces/http/routes/admin/advertising.ts POST /meta/test-event",
  "apps/api/src/interfaces/http/routes/admin/advertising.ts POST /tiktok/test-event",
  "apps/api/src/interfaces/http/routes/admin/advertising.ts POST /tiktok/connect",
  "apps/api/src/interfaces/http/routes/admin/advertising.ts POST /spotify/connect",
  "apps/api/src/interfaces/http/routes/admin/advertising.ts POST /audiences/:platform/run",
  "apps/api/src/interfaces/http/routes/admin/advertising.ts POST /spend/import/:platform",
  "apps/api/src/interfaces/http/routes/admin/advertising.ts POST /spend/csv",
  "apps/api/src/interfaces/http/routes/admin/advertising.ts PUT /spotify/featured",
  "apps/api/src/interfaces/http/routes/admin/advertising.ts POST /offline/sales",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts POST /projects",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts PATCH /projects/:project",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts POST /projects/:project/reclassify",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts POST /projects/:project/competitors/:competitorId/pin",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts DELETE /projects/:project/competitors/:competitorId/pin",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts POST /projects/:project/queries",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts PATCH /projects/:project/queries/:queryId",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts PATCH /projects/:project/providers/:provider",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts PUT /projects/:project/providers/:provider/credential",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts DELETE /projects/:project/providers/:provider/credential",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts POST /projects/:project/providers/:provider/test",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts POST /projects/:project/runs",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts POST /projects/:project/research",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts POST /projects/:project/runs/:runId/approve",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts POST /projects/:project/runs/:runId/reject",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts POST /projects/:project/runs/:runId/cancel",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts POST /projects/:project/actions",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts POST /projects/:project/actions/:actionId/submit",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts POST /projects/:project/actions/:actionId/approve",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts POST /projects/:project/actions/:actionId/reject",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts POST /projects/:project/actions/:actionId/execute",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts POST /projects/:project/actions/:actionId/start-run",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts POST /projects/:project/actions/:actionId/verify",
  "apps/api/src/interfaces/http/routes/admin/ai-visibility.ts POST /projects/:project/actions/:actionId/cancel",
  "apps/api/src/interfaces/http/routes/admin/locations.ts POST /places-probe",
  "apps/api/src/interfaces/http/routes/admin/loyalty.ts POST /gamification/missions/:id/dry-evaluate",
  "apps/api/src/interfaces/http/routes/admin/loyalty.ts POST /adjust",
  "apps/api/src/interfaces/http/routes/admin/loyalty.ts PUT /programme-config",
  "apps/api/src/interfaces/http/routes/admin/loyalty.ts POST /accounts/merge",
  "apps/api/src/interfaces/http/routes/admin/loyalty.ts POST /tiers/evaluate",
  "apps/api/src/interfaces/http/routes/admin/measurement-delivery.ts POST /replay/preview",
  "apps/api/src/interfaces/http/routes/admin/measurement-delivery.ts POST /replay",
  "apps/api/src/interfaces/http/routes/admin/measurement-delivery.ts POST /quarantine",
  "apps/api/src/interfaces/http/routes/admin/measurement-delivery.ts POST /kill-switch",
  "apps/api/src/interfaces/http/routes/admin/measurement-delivery.ts POST /attribution/run",
  "apps/api/src/interfaces/http/routes/admin/measurement-mmm.ts PUT /settings/:key",
  "apps/api/src/interfaces/http/routes/admin/measurement-mmm.ts DELETE /settings/:key",
  "apps/api/src/interfaces/http/routes/admin/media.ts POST /attach-by-code/preview",
  "apps/api/src/interfaces/http/routes/admin/product-costs.ts POST /import/preview",
  "apps/api/src/interfaces/http/routes/admin/products.ts POST /:id/images",
  "apps/api/src/interfaces/http/routes/admin/products.ts PUT /:id/media",
  "apps/api/src/interfaces/http/routes/admin/products.ts POST /:id/media/upload",
  "apps/api/src/interfaces/http/routes/admin/seo-observability.ts POST /render-diff/compare",
  "apps/api/src/interfaces/http/routes/admin/seo-robots.ts POST /validate",
];
