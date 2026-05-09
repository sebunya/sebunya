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
    }
  });
});
