import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('UTM link destination URL (0163)', () => {
  it('adds a nullable destination_url column and registers it in the journal', () => {
    expect(read('apps/api/src/infrastructure/db/migrations/0163_utm_link_destination_url.sql'))
      .toContain('ALTER TABLE utm_links ADD COLUMN IF NOT EXISTS destination_url text;');
    const journal = JSON.parse(read('apps/api/src/infrastructure/db/migrations/meta/_journal.json'));
    const last = journal.entries[journal.entries.length - 1];
    expect(last).toMatchObject({ idx: 163, tag: '0163_utm_link_destination_url' });
    expect(read('apps/api/src/infrastructure/db/schema/advertising.ts')).toContain("destinationUrl: text('destination_url')");
  });
  it('the route validates an http(s) destination and strips its own utm_ tags', () => {
    const route = read('apps/api/src/interfaces/http/routes/admin/campaigns.ts');
    expect(route).toContain("/^https?:$/.test(parsed.protocol)");
    expect(route).toContain("startsWith('utm_')");
    expect(route).toContain('addUtmLink(id, { ...utm, content, term, destinationUrl })');
  });
  it('the builder sends the landing page with the saved tags', () => {
    expect(read('apps/web/src/pages/admin/utm-builder/index.astro')).toContain('destinationUrl:');
  });
});
