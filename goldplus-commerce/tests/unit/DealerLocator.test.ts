import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('Dealer locator (0219)', () => {
  it('migration is journalled and nothing is public by default', () => {
    const sql = read('apps/api/src/infrastructure/db/migrations/0219_dealer_listing.sql');
    expect(sql).toContain('"listed_publicly" boolean NOT NULL DEFAULT false');
    expect(read('apps/api/src/infrastructure/db/migrations/meta/_journal.json')).toContain('"tag": "0219_dealer_listing"');
  });
  it('the public endpoint exposes only name, town, address, phone, country', () => {
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleDealerRepository.ts');
    const pub = repo.slice(repo.indexOf('async listPublic'), repo.indexOf('async setListing'));
    expect(pub).not.toMatch(/email|tinNumber|contactName/);
    expect(read('apps/api/src/interfaces/http/routes/governance.ts')).toContain("routes.post('/admin/dealers/:id/listing', requirePermissions([PERMISSIONS.DEALER_APPROVE])");
  });
  it('the page is noindex and says so plainly while no dealer is listed', () => {
    const page = read('apps/web/src/pages/dealers/index.astro');
    expect(page).toContain("robotsMeta={dealers.length === 0 ? 'noindex,follow' : undefined}");
    expect(page).toContain('No shops are listed yet.');
  });
});
