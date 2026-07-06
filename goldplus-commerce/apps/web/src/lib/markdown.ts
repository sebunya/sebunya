/**
 * Minimal, safe markdown renderer for CMS page bodies.
 *
 * Deliberately a small subset — headings, bold, italic, inline code,
 * links, unordered/ordered lists, blockquotes, and paragraphs. All text
 * is HTML-escaped BEFORE inline formatting is applied, and links are
 * restricted to http(s)/mailto, so stored content cannot inject markup
 * or script. This is not a full CommonMark implementation.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHref(url: string): string | null {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed) || trimmed.startsWith('/')) {
    return trimmed;
  }
  return null;
}

function renderInline(text: string): string {
  let out = escapeHtml(text);
  // Links: [label](url) — label and url already escaped above.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
    const href = safeHref(url.replace(/&amp;/g, '&'));
    if (!href) return label;
    return `<a href="${escapeHtml(href)}" rel="noopener">${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  return out;
}

export function renderMarkdown(markdown: string): string {
  const lines = (markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim() === '') {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length + 1; // h2..h4 (reserve h1 for page title)
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^>\s+/.test(line)) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${renderInline(line.replace(/^>\s+/, ''))}</blockquote>`);
      continue;
    }

    const ulItem = /^[-*]\s+(.*)$/.exec(line);
    const olItem = /^\d+\.\s+(.*)$/.exec(line);
    if (ulItem || olItem) {
      flushParagraph();
      const wanted = ulItem ? 'ul' : 'ol';
      if (listType !== wanted) {
        closeList();
        listType = wanted;
        html.push(`<${wanted}>`);
      }
      html.push(`<li>${renderInline((ulItem ?? olItem)![1])}</li>`);
      continue;
    }

    closeList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  closeList();
  return html.join('\n');
}
