import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseGuideFile, internalLinks } from '../../apps/api/src/domain/blog/GuideFile';
import { canPublish, slugifyTitle } from '../../apps/api/src/domain/blog/BlogPost';

/**
 * Every guide under docs/content/guides is published in one host run (scripts/publish-guides.ts).
 * A file that fails to parse, fails the publish gate, or collides with another guide's slug would
 * stop or silently overwrite an article, so the whole set is checked here, before it reaches the host.
 */
const DIR = join(__dirname, '../../docs/content/guides');
const files = readdirSync(DIR).filter((f) => /^\d+-.*\.md$/.test(f)).sort();
const guides = files.map((f) => ({ f, parsed: parseGuideFile(readFileSync(join(DIR, f), 'utf8')) }));

// Listings whose stated wattage is under review (docs/content/guides/README.md): no guide recommends them.
const UNDER_REVIEW = ['GP-C10', 'GP-C12', 'GP-C13', 'GP-CA01'];

describe('blog guides', () => {
  it('has the planned set (100+ articles)', () => {
    expect(files.length).toBeGreaterThanOrEqual(100);
  });

  it.each(guides)('$f parses and passes the publish gate', ({ parsed }) => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const g = parsed.value;
    expect(canPublish({ title: g.title, excerpt: g.excerpt, body: g.body })).toEqual({ ok: true });
    expect(g.metaTitle).toBeTruthy();
    expect(g.metaDescription).toBeTruthy();
    for (const sku of UNDER_REVIEW) expect(g.relatedSkus).not.toContain(sku);
    for (const link of internalLinks(g.body)) expect(link).not.toMatch(/^\/(delivery|locations|dealers)$/); // these paths 404; hubs live below them
  });

  it('gives every guide its own URL', () => {
    const slugs = guides.flatMap(({ parsed }) => (parsed.ok ? [slugifyTitle(parsed.value.title)] : []));
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
