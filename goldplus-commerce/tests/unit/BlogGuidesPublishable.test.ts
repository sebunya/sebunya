import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseGuideFile, internalLinks, guideChanged } from '../../apps/api/src/domain/blog/GuideFile';
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

describe('republishing guides moves dateModified only for real edits', () => {
  const stored = { title: 'Tecno battery codes', excerpt: 'Why the code matters.', body: 'Body text.', metaTitle: 'Tecno codes | GoldPlus', metaDescription: 'Codes explained.', relatedProductIds: ['a', 'b'] };
  const same = { ...stored, relatedProductIds: [...stored.relatedProductIds] };
  it('an identical file, or one differing only by whitespace a save trims, is unchanged', () => {
    expect(guideChanged(stored, same)).toBe(false);
    expect(guideChanged(stored, { ...same, title: '  Tecno battery codes ', excerpt: 'Why the code matters.\n' })).toBe(false);
  });
  it('any field the file controls, or the related products, is a change', () => {
    expect(guideChanged(stored, { ...same, body: 'Body text, edited.' })).toBe(true);
    expect(guideChanged(stored, { ...same, metaDescription: null })).toBe(true);
    expect(guideChanged(stored, { ...same, relatedProductIds: ['b', 'a'] })).toBe(true);
    expect(guideChanged(stored, { ...same, title: 'x' })).toBe(true); // invalid: let the save report it
  });
  it('the publisher skips unchanged guides and keeps a cover set in the editor', () => {
    const script = readFileSync(join(__dirname, '../../apps/api/src/scripts/publish-guides.ts'), 'utf8');
    expect(script).toMatch(/if \(existing && same\) \{\s*post = existing; unchanged \+= 1;/);
    expect(script).toContain('coverImageUrl: existing?.coverImageUrl ?? null, coverImageAlt: existing?.coverImageAlt ?? null');
  });
});

