import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Authorization is fail-closed by construction, but only where it is applied.
 * Nothing previously stopped a new admin route from shipping without a guard —
 * the omission looks exactly like every other route in the diff.
 *
 * This walks the real admin route files rather than trusting a list.
 */
const ADMIN_DIR = join(__dirname, '../../apps/api/src/interfaces/http/routes/admin');
const files = readdirSync(ADMIN_DIR).filter((f) => f.endsWith('.ts'));

const HANDLER = /^\s*(?:routes|admin|app)\s*\.\s*(get|post|put|patch|delete)\s*\(/gm;

describe('every admin route is behind a permission gate', () => {
  it('found admin route files to check', () => {
    // A directory-walking test that silently matches nothing is not a test.
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)('%s guards every handler', (file) => {
    const source = readFileSync(join(ADMIN_DIR, file), 'utf8');

    // A blanket gate covers the whole router, which several files use.
    const blanket = /\.use\(\s*['"`]\*['"`]\s*,\s*requirePermissions/.test(source);
    if (blanket) return;

    const handlers = [...source.matchAll(HANDLER)];
    for (const match of handlers) {
      // The guard may sit on the next line — several files use the multi-line
      // form — so look at the handler's argument list, not just its first line.
      const window = source.slice(match.index!, match.index! + 400);
      expect(
        window.includes('requirePermissions'),
        `${file}: ${match[1].toUpperCase()} handler at offset ${match.index} has no requirePermissions`,
      ).toBe(true);
    }
  });

  it('every admin router authenticates before it authorises', () => {
    for (const file of files) {
      const source = readFileSync(join(ADMIN_DIR, file), 'utf8');
      if (!HANDLER.test(source)) continue;
      HANDLER.lastIndex = 0;
      expect(source, `${file} has handlers but no authMiddleware`).toContain('authMiddleware');
    }
  });
});

describe('the permission gate itself', () => {
  const source = readFileSync(
    join(__dirname, '../../apps/api/src/interfaces/http/middleware/permissions.ts'),
    'utf8',
  );

  it('requires ALL listed permissions, not any of them', () => {
    // `some` here would silently widen every multi-permission route.
    expect(source).toContain('.filter((perm) => !granted.has(perm))');
    expect(source).not.toMatch(/requiredPermissions\.some\(/);
  });

  it('records denials so repeated refusals are noticeable', () => {
    expect(source).toContain('AUTHZ_DENIED');
    expect(source).toContain('actorId');
  });

  it('does not write to the database on the denial path', () => {
    // Any valid session could otherwise drive unbounded writes by hammering an
    // endpoint it cannot use.
    expect(source).not.toMatch(/Registry|auditRepo|db\./);
  });

  it('does not tell the caller which permission was missing', () => {
    // That maps out the permission model for anyone probing it.
    const responseBlock = source.slice(source.indexOf('if (missing.length > 0)'));
    expect(responseBlock).toContain('Insufficient permissions to perform this action.');
    expect(responseBlock).not.toMatch(/message:.*\$\{.*missing/);
  });

  it('logs what was missing rather than everything the actor holds', () => {
    expect(source).toContain('missing,');
    expect(source).not.toContain('permissions: user.permissions');
  });
});
