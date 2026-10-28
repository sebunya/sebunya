import { validateBlogPost } from './BlogPost';

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

/** The value after `Label:` on the first header line that starts with it (case-insensitive). */
const field = (header: string, label: string): string | null => {
  const prefix = `${label.toLowerCase()}:`;
  for (const line of header.split('\n')) {
    if (line.toLowerCase().startsWith(prefix)) {
      const v = line.slice(prefix.length).trim();
      return v ? v : null;
    }
  }
  return null;
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

/** The stored fields a guide file controls (BlogPostRecord), plus the post's related products in order. */
export interface StoredGuide {
  title: string;
  excerpt: string;
  body: string;
  metaTitle: string | null;
  metaDescription: string | null;
  relatedProductIds: string[];
}

/**
 * Would publishing this guide file change the stored article? Compared after
 * the same normalisation a save applies (validateBlogPost), so whitespace a
 * save would trim is not a change. The publisher skips an unchanged guide:
 * rewriting it moved `updatedAt`, which the page publishes as dateModified and
 * the blog sitemap as lastmod, so one deploy stamped all 103 guides "modified"
 * within three seconds when four had changed (2026-10-28). A file that cannot
 * be validated counts as changed, so the save itself reports the problem.
 */
export function guideChanged(stored: StoredGuide, next: { title: string; excerpt: string; body: string; metaTitle: string | null; metaDescription: string | null; relatedProductIds: string[] }): boolean {
  const v = validateBlogPost(next);
  if (!v.ok) return true;
  const n = v.value;
  return n.title !== stored.title
    || n.excerpt !== stored.excerpt
    || n.body !== stored.body
    || (n.metaTitle ?? null) !== (stored.metaTitle ?? null)
    || (n.metaDescription ?? null) !== (stored.metaDescription ?? null)
    || n.relatedProductIds.join(',') !== stored.relatedProductIds.join(',');
}
