/**
 * The guide-draft file format under docs/content/guides. Pure — no fs.
 *
 * A draft is a labelled header (Title, Summary, Meta title, Meta description,
 * optional Related SKUs and Publish) followed by a marker line and the article
 * body in the blog's own restricted markup. Parsing it here, rather than in the
 * publishing script, lets the format be unit-tested without a database.
 */
export interface GuideFile {
  title: string;
  excerpt: string;
  metaTitle: string | null;
  metaDescription: string | null;
  /** Catalogue SKUs the article should recommend; resolved to ids at publish time. */
  relatedSkus: string[];
  /** `Publish: hold` keeps the article a DRAFT until an operator publishes it by hand. */
  hold: boolean;
  body: string;
}

export const ARTICLE_MARKER = /^---- Article\b/m;

const field = (header: string, label: string): string | null => {
  const m = header.match(new RegExp(`^${label}:[ \\t]*(.*)$`, 'mi'));
  const v = m?.[1]?.trim() ?? '';
  return v ? v : null;
};

export function parseGuideFile(text: string): { ok: true; value: GuideFile } | { ok: false; message: string } {
  const at = text.search(ARTICLE_MARKER);
  if (at < 0) return { ok: false, message: 'No "---- Article" marker line; nothing separates the header from the body.' };
  const header = text.slice(0, at);
  const afterMarker = text.slice(at).replace(/^[^\n]*\n?/, '');
  const body = afterMarker.replace(/^\s*\n/, '').trimEnd();

  const title = field(header, 'Title');
  if (!title) return { ok: false, message: 'Missing "Title:" line.' };
  const excerpt = field(header, 'Summary');
  if (!excerpt) return { ok: false, message: 'Missing "Summary:" line.' };
  if (!body) return { ok: false, message: 'The article body is empty.' };

  const skus = (field(header, 'Related SKUs') ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  return {
    ok: true,
    value: {
      title,
      excerpt,
      metaTitle: field(header, 'Meta title'),
      metaDescription: field(header, 'Meta description'),
      relatedSkus: Array.from(new Set(skus)),
      hold: /^hold$/i.test(field(header, 'Publish') ?? ''),
      body,
    },
  };
}

/** Site-relative links in a body, so a publisher can refuse an article that points at a page that does not exist. */
export function internalLinks(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\]\((\/[^)\s]*)\)/g)) out.add(m[1]!);
  return Array.from(out);
}
