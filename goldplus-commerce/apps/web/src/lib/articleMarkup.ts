/**
 * The article renderer: a small, deliberately restricted markup.
 *
 * The operator writes plain text with a few marks. It is NOT Markdown and it is
 * NOT HTML — every character is escaped FIRST, and only the marks below are
 * then turned into tags. That order is the whole security design: an admin
 * editor that stores and replays raw HTML is a stored-XSS hole pointed at the
 * operator's own session, and no amount of stripping tags afterwards is as safe
 * as never trusting them in the first place.
 *
 * Supported, because they are what an article actually needs:
 *   # H2, ## H3            headings (never H1 — the page title owns that)
 *   - item                 bullet list
 *   1. item                numbered list
 *   > quote                pull quote
 *   **bold**  *italic*     emphasis
 *   [text](/path)          link, internal or https only
 *   blank line             new paragraph
 */

import { safeReturnTo } from './safeReturnTo';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

/**
 * Links may only point at this site or at https. A javascript: or data: URL in
 * an article body would run in the reader's browser as our own page. A site
 * path goes through safeReturnTo, the one same-origin rule: '/\\evil.com'
 * starts with '/' but a browser resolves it to https://evil.com/.
 */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  if (href.startsWith('/')) return safeReturnTo(href, '') || null;
  if (/^https:\/\/[^\s"'<>\\]+$/i.test(href)) return href;
  return null;
}

function emphasis(text: string): string {
  return text
    .replace(/\*\*([^*\n]{1,300})\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]{1,300})\*(?!\*)/g, '$1<em>$2</em>');
}

/** Inline marks, applied to text that is ALREADY escaped. */
function inline(escaped: string): string {
  // Links first, each held aside as a placeholder, so emphasis never reaches
  // inside a generated tag (a '*' in an href used to become <em> in the URL).
  const anchors: string[] = [];
  let out = escaped.replace(/\u0000/g, '');
  out = out.replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g, (_whole, label: string, href: string) => {
    const safe = safeHref(href.replace(/&amp;/g, '&'));
    if (!safe) return label; // A refused link degrades to its own words.
    const external = safe.startsWith('https://');
    const rel = external ? ' rel="nofollow noopener" target="_blank"' : '';
    anchors.push(`<a href="${escapeHtml(safe)}" class="gp-article__link"${rel}>${emphasis(label)}</a>`);
    return `\u0000${anchors.length - 1}\u0000`;
  });
  out = emphasis(out);
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => anchors[Number(i)] ?? '');
}

/** The article as HTML, safe to inject with set:html. */
export function renderArticle(body: string): string {
  const lines = escapeHtml(String(body ?? '')).split(/\r?\n/);
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushAll();
      continue;
    }
    const heading = /^(#{1,2})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushAll();
      const level = heading[1].length === 1 ? 2 : 3;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const quote = /^&gt;\s+(.*)$/.exec(trimmed);
    if (quote) {
      flushAll();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      if (list?.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
      list.items.push(bullet[1]);
      continue;
    }
    const numbered = /^\d{1,3}\.\s+(.*)$/.exec(trimmed);
    if (numbered) {
      flushParagraph();
      if (list?.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
      list.items.push(numbered[1]);
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  flushAll();
  return out.join('\n');
}

/** Plain text, for meta descriptions and JSON-LD where markup is noise. */
export function articlePlainText(body: string, limit = 300): string {
  const text = String(body ?? '')
    .replace(/\[([^\]\n]*)\]\([^)\s]*\)/g, '$1')
    .replace(/[#>*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}
