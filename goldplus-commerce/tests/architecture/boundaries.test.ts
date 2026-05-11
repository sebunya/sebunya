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
      // Skip explicitly identified legacy leaks documented for refactoring in the next pass
      if (file.includes("DealerApplicationUseCase.ts") || file.includes("VerificationCheckUseCase.ts")) {
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

    const writeVerbRegex = /\b(routes|app)\.(post|put|patch|delete)\s*\(/;
    const auditRegex = /\bauditUc\.execute\s*\(|CreateAuditLogUseCase/;
    const exemptionMarker = /\/\/\s*audit-exempt:/;

    for (const file of candidateFiles) {
      const content = fs.readFileSync(file, "utf8");
      const hasWrite = writeVerbRegex.test(content);
      if (!hasWrite) continue;
      if (exemptionMarker.test(content)) continue;
      const hasAudit = auditRegex.test(content);
      expect(
        hasAudit,
        `${file} contains write verbs but never calls CreateAuditLogUseCase. ` +
          `Either add audit, or add a "// audit-exempt: <reason>" comment for write endpoints that have a dedicated audit channel.`,
      ).toBe(true);
    }
  });
});

