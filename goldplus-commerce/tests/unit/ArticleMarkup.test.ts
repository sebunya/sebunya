import { describe, expect, it } from 'vitest';
import { renderArticle, articlePlainText, escapeHtml } from '../../apps/web/src/lib/articleMarkup';

/**
 * The article body is operator-written text that is replayed into a page. Every
 * character is escaped BEFORE any mark is interpreted, so nothing an author
 * types — deliberately or by paste — can become live markup. These tests are
 * the proof of that ordering.
 */
describe('nothing in an article body can become markup', () => {
  it('a script tag is text, not a script', () => {
    const html = renderArticle('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('an event handler cannot be smuggled through a link label', () => {
    const html = renderArticle('[click" onmouseover="alert(1)](/shop)');
    // The words may survive as visible TEXT; what must not survive is a quote
    // that closes href and opens an attribute. Assert on the tag itself.
    const openingTag = /<a[^>]*>/.exec(html)?.[0] ?? '';
    expect(openingTag).not.toMatch(/onmouseover/);
    expect(openingTag).toBe('<a href="/shop" class="gp-article__link">');
    expect(html).toContain('&quot;');
  });

  it('a javascript: url is refused and degrades to its own words', () => {
    const html = renderArticle('[tap here](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('tap here');
    expect(html).not.toContain('<a ');
  });

  it('a data: url is refused too', () => {
    expect(renderArticle('[x](data:text/html;base64,PHNjcmlwdD4=)')).not.toContain('<a ');
  });

  it('a protocol-relative url cannot impersonate an internal link', () => {
    expect(renderArticle('[x](//evil.example/phish)')).not.toContain('<a ');
  });

  it('plain http is refused; only https or our own paths are linked', () => {
    expect(renderArticle('[x](http://evil.example)')).not.toContain('<a ');
    expect(renderArticle('[x](https://good.example)')).toContain('href="https://good.example"');
    expect(renderArticle('[shop](/shop?category=power)')).toContain('href="/shop?category=power"');
  });

  it('an external link is nofollow and cannot reach back through window.opener', () => {
    const html = renderArticle('[x](https://good.example)');
    expect(html).toContain('rel="nofollow noopener"');
    expect(html).toContain('target="_blank"');
  });

  it('an internal link stays a plain, followable link', () => {
    const html = renderArticle('[our chargers](/shop?category=power)');
    expect(html).not.toContain('nofollow');
    expect(html).not.toContain('target=');
  });
});

describe('the marks an article actually needs', () => {
  it('headings start at h2, because the page title owns h1', () => {
    expect(renderArticle('# A section')).toBe('<h2>A section</h2>');
    expect(renderArticle('## Smaller')).toBe('<h3>Smaller</h3>');
    expect(renderArticle('# A section')).not.toContain('<h1>');
  });

  it('blank lines separate paragraphs and wrapped lines join', () => {
    expect(renderArticle('One line\nstill one.\n\nSecond.')).toBe('<p>One line still one.</p>\n<p>Second.</p>');
  });

  it('bullets and numbers become real lists that close', () => {
    expect(renderArticle('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(renderArticle('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('a list ends when prose resumes', () => {
    expect(renderArticle('- a\n\nAfter.')).toBe('<ul><li>a</li></ul>\n<p>After.</p>');
  });

  it('quotes, bold and italic', () => {
    expect(renderArticle('> Said so')).toBe('<blockquote>Said so</blockquote>');
    expect(renderArticle('**loud** and *soft*')).toBe('<p><strong>loud</strong> and <em>soft</em></p>');
  });

  it('an empty body renders nothing rather than an empty tag', () => {
    expect(renderArticle('')).toBe('');
    expect(renderArticle('   \n\n  ')).toBe('');
  });
});

describe('plain text for meta descriptions and JSON-LD', () => {
  it('drops the marks and keeps the words', () => {
    expect(articlePlainText('# Title\n\n**Bold** [link](/shop) text')).toBe('Title Bold link text');
  });

  it('truncates on a boundary with an ellipsis', () => {
    const out = articlePlainText('word '.repeat(200), 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('…')).toBe(true);
  });

  it('escapeHtml covers every character that could start a tag or attribute', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
