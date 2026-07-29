import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');
const adminPagesDir = path.join(repoRoot, 'apps/web/src/pages/admin');
const adminLibDir = path.join(repoRoot, 'apps/web/src/lib');

/**
 * Strings that must never reach the production admin UI.
 *
 * Each one collapses a real distinction the Control Centre now models properly:
 * "API unavailable" hides whether the cause was permission, a missing route, a
 * dependency failure or absent configuration; "Coming soon" and "Needs
 * configuration" describe a business activation state as though the service were
 * broken. They are permitted in tests and historical documentation only.
 */
const FORBIDDEN_COPY = [
  'API UNAVAILABLE',
  'API unavailable',
  'COMING SOON',
  'Coming soon',
  'NEEDS CONFIGURATION',
  'Needs configuration',
  'Live action: blocked',
];

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(astro|ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('production admin copy', () => {
  const files = [...walk(adminPagesDir), ...walk(adminLibDir)];

  it('scans a non-trivial number of admin source files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(FORBIDDEN_COPY)('never renders %s in the production admin UI', (phrase) => {
    const offenders = files.filter((file) => fs.readFileSync(file, 'utf8').includes(phrase));
    expect(
      offenders.map((f) => path.relative(repoRoot, f)),
      `"${phrase}" must not appear in the production admin UI — model the real cause instead`,
    ).toEqual([]);
  });
});
