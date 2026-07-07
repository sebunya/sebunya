import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../apps/web/src/lib/markdown';

describe('renderMarkdown (safe subset)', () => {
  it('renders headings as h2-h4 (reserving h1 for the page title)', () => {
    expect(renderMarkdown('# Big')).toContain('<h2>Big</h2>');
    expect(renderMarkdown('## Mid')).toContain('<h3>Mid</h3>');
    expect(renderMarkdown('### Small')).toContain('<h4>Small</h4>');
  });

  it('renders bold, italic, and inline code', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
    expect(renderMarkdown('a *word* here')).toContain('<em>word</em>');
    expect(renderMarkdown('use `code`')).toContain('<code>code</code>');
  });

  it('renders unordered and ordered lists', () => {
    const ul = renderMarkdown('- one\n- two');
    expect(ul).toContain('<ul>');
    expect(ul).toContain('<li>one</li>');
    const ol = renderMarkdown('1. first\n2. second');
    expect(ol).toContain('<ol>');
    expect(ol).toContain('<li>first</li>');
  });

  it('escapes raw HTML to prevent injection', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('allows safe links but drops javascript: URLs', () => {
    const safe = renderMarkdown('[click](https://example.com)');
    expect(safe).toContain('<a href="https://example.com"');

    const unsafe = renderMarkdown('[x](javascript:alert(1))');
    expect(unsafe).not.toContain('href="javascript');
    expect(unsafe).toContain('x'); // label preserved, link stripped
  });

  it('groups consecutive lines into a paragraph', () => {
    const html = renderMarkdown('line one\nline two');
    expect(html).toContain('<p>line one line two</p>');
  });
});
