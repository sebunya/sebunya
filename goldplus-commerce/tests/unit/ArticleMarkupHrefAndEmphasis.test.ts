import { describe, expect, it } from 'vitest';
import { renderArticle, safeHref } from '../../apps/web/src/lib/articleMarkup';

describe('article links and emphasis', () => {
  it('refuses /\\ paths that a browser resolves off-site', () => {
    expect(safeHref('/\\evil.com')).toBeNull();
    expect(safeHref('//evil.com')).toBeNull();
    expect(safeHref('https://a.com\\@evil.com')).toBeNull();
    expect(safeHref('/guides/x?y=1#z')).toBe('/guides/x?y=1#z');
    expect(renderArticle('[go](/\\evil.com)')).not.toContain('<a ');
  });

  it('never puts emphasis tags inside a generated href', () => {
    const html = renderArticle('see [the *best* one](/p/a*b*c) and **this**');
    expect(html).toContain('href="/p/a*b*c"');
    expect(html).toContain('the <em>best</em> one</a>');
    expect(html).toContain('<strong>this</strong>');
    expect(html).not.toMatch(/href="[^"]*<em>/);
  });
});
