import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normaliseUtmDestination } from '../../apps/api/src/application/use-cases/campaigns/CampaignScaffold';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('UTM link destination URL (0163)', () => {
  it('adds a nullable destination_url column and registers it in the journal', () => {
    expect(read('apps/api/src/infrastructure/db/migrations/0163_utm_link_destination_url.sql'))
      .toContain('ALTER TABLE utm_links ADD COLUMN IF NOT EXISTS destination_url text;');
    const journal = JSON.parse(read('apps/api/src/infrastructure/db/migrations/meta/_journal.json'));
    const entry = journal.entries.find((e: { tag: string }) => e.tag === '0163_utm_link_destination_url');
    expect(entry).toMatchObject({ idx: 163 });
    expect(read('apps/api/src/infrastructure/db/schema/advertising.ts')).toContain("destinationUrl: text('destination_url')");
  });
  it('accepts an http(s) destination, strips its own utm_ tags, and refuses anything else', () => {
    expect(normaliseUtmDestination('  https://shopgoldplus.com/shop?category=power&utm_source=x&UTM_Medium=y ')).toEqual({
      ok: true, destinationUrl: 'https://shopgoldplus.com/shop?category=power',
    });
    expect(normaliseUtmDestination('')).toEqual({ ok: true, destinationUrl: null });
    expect(normaliseUtmDestination(undefined)).toEqual({ ok: true, destinationUrl: null });
    expect(normaliseUtmDestination('/shop').ok).toBe(false);
    expect(normaliseUtmDestination('javascript:alert(1)').ok).toBe(false);
    expect(normaliseUtmDestination(`https://shopgoldplus.com/${'a'.repeat(2050)}`).ok).toBe(false);
    // The route hands the normalised value to the repository.
    const route = read('apps/api/src/interfaces/http/routes/admin/campaigns.ts');
    expect(route).toContain('normaliseUtmDestination(body?.destinationUrl)');
    expect(route).toContain('addUtmLink(id, { ...utm, content, term, destinationUrl })');
  });
  it('the builder sends the landing page with the saved tags', () => {
    expect(read('apps/web/src/pages/admin/utm-builder/index.astro')).toContain('destinationUrl:');
  });
});
