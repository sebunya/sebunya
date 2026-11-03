import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, '../../../apps/api/src/interfaces/http/routes/admin/locations.ts'), 'utf8');
const resolve = route.slice(route.indexOf("'/review-queue/:addressId/resolve'"), route.indexOf('// ── Landmark manager'));

describe('alias promoted while resolving an address', () => {
  it('checks the promotion result and audits a created alias', () => {
    expect(resolve).toMatch(/const promoted = await registry\.promoteSearchMissToAliasUseCase\.execute/);
    expect(resolve).toMatch(/if \(promoted\.ok\)[\s\S]*action: 'LOCATION_ALIAS_PROMOTED'/);
    expect(resolve).toMatch(/alias = \{ error: promoted\.message \}/);
  });
  it('the admin page shows a refused alias', () => {
    const page = readFileSync(join(__dirname, '../../../apps/web/src/pages/admin/locations.astro'), 'utf8');
    expect(page).toMatch(/json\.data\?\.alias\?\.error/);
  });
});
