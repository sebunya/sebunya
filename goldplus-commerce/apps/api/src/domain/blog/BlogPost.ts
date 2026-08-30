/**
 * Editorial article rules (0126). Pure — no Hono, Drizzle or adapters.
 *
 * The blog exists to answer the informational demand the catalogue cannot: the
 * questions people type before they know what to buy. That only earns traffic
 * if the articles are real, so the rules here are about substance rather than
 * ceremony — an article cannot be published without a title, a slug, a summary
 * and a body, because a published stub is worse than no page at all.
 */

export const BLOG_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type BlogStatus = (typeof BLOG_STATUSES)[number];

export const MAX_TITLE = 200;
export const MAX_EXCERPT = 400;
export const MAX_BODY = 60_000;
export const MAX_META_TITLE = 200;
export const MAX_META_DESCRIPTION = 320;
export const MAX_RELATED_PRODUCTS = 6;

/** Words a minute for the reading estimate. Deliberately unhurried. */
const READING_WORDS_PER_MINUTE = 200;

/** The shortest body that can honestly be called an article rather than a stub. */
export const MIN_PUBLISHABLE_BODY_WORDS = 80;

export interface BlogPostInput {
  title: string;
  slug?: string;
  excerpt: string;
  body: string;
  coverImageUrl?: string | null;
  coverImageAlt?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
  relatedProductIds?: string[];
}

export type BlogValidation =
  | { ok: true; value: Required<Pick<BlogPostInput, 'title' | 'excerpt' | 'body'>> & {
      slug: string;
      coverImageUrl: string | null;
      coverImageAlt: string | null;
      metaTitle: string | null;
      metaDescription: string | null;
      relatedProductIds: string[];
    } }
  | { ok: false; code: string; message: string };

export function isBlogStatus(value: string): value is BlogStatus {
  return (BLOG_STATUSES as readonly string[]).includes(value);
}

/**
 * A URL-safe slug. Kept ASCII and lowercase because it becomes a permanent
 * public URL, and a slug that changes costs every link that ever pointed at it.
 */
export function slugifyTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200)
    .replace(/-+$/g, '');
}

export function countWords(body: string): number {
  const plain = body.replace(/[#>*_`\[\]()!-]/g, ' ').trim();
  return plain ? plain.split(/\s+/).filter(Boolean).length : 0;
}

export function readingMinutes(body: string): number {
  return Math.max(1, Math.round(countWords(body) / READING_WORDS_PER_MINUTE));
}

const trim = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/**
 * Validates an article for saving. A DRAFT may be incomplete — that is what a
 * draft is for — so only the title is demanded here; publishing is what
 * enforces substance, in `canPublish`.
 */
export function validateBlogPost(input: BlogPostInput): BlogValidation {
  const title = trim(input.title, MAX_TITLE);
  if (title.length < 3) {
    return { ok: false, code: 'TITLE_REQUIRED', message: 'An article needs a title of at least 3 characters.' };
  }

  const slug = slugifyTitle(input.slug?.trim() ? input.slug : title);
  if (!slug) {
    return { ok: false, code: 'SLUG_INVALID', message: 'The title must contain letters or numbers so it can form a web address.' };
  }

  const body = typeof input.body === 'string' ? input.body.slice(0, MAX_BODY) : '';
  const relatedProductIds = Array.from(new Set(input.relatedProductIds ?? [])).slice(0, MAX_RELATED_PRODUCTS);

  return {
    ok: true,
    value: {
      title,
      slug,
      excerpt: trim(input.excerpt, MAX_EXCERPT),
      body,
      coverImageUrl: trim(input.coverImageUrl, 1000) || null,
      coverImageAlt: trim(input.coverImageAlt, 300) || null,
      metaTitle: trim(input.metaTitle, MAX_META_TITLE) || null,
      metaDescription: trim(input.metaDescription, MAX_META_DESCRIPTION) || null,
      relatedProductIds,
    },
  };
}

/**
 * Publishing is the gate. An article that reaches Google as a stub costs more
 * than it earns: it competes with the pages that do answer the question, and
 * it teaches a first-time reader that this shop has nothing to say.
 */
export function canPublish(post: { title: string; excerpt: string; body: string; coverImageAlt?: string | null; coverImageUrl?: string | null }):
  | { ok: true }
  | { ok: false; code: string; message: string } {
  if (!post.title.trim()) {
    return { ok: false, code: 'TITLE_REQUIRED', message: 'An article needs a title before it can be published.' };
  }
  if (!post.excerpt.trim()) {
    return {
      ok: false,
      code: 'EXCERPT_REQUIRED',
      message: 'Write a one-sentence summary. It is what a reader sees in Google and on the article cards.',
    };
  }
  const words = countWords(post.body);
  if (words < MIN_PUBLISHABLE_BODY_WORDS) {
    return {
      ok: false,
      code: 'BODY_TOO_SHORT',
      message: `An article needs at least ${MIN_PUBLISHABLE_BODY_WORDS} words to be worth a reader's time; this one has ${words}.`,
    };
  }
  if (post.coverImageUrl && !post.coverImageAlt?.trim()) {
    return {
      ok: false,
      code: 'COVER_ALT_REQUIRED',
      message: 'Describe the cover image. Without alt text it is invisible to a screen reader and to search.',
    };
  }
  return { ok: true };
}

/**
 * The date shown to readers and crawlers. Set once, on the FIRST publish, and
 * never moved by a later edit — a fresh date on an unchanged article is a lie
 * to both, and re-dating old posts to look current is exactly the trick search
 * engines penalise.
 */
export function resolvePublishedAt(existing: Date | null, now: Date): Date {
  return existing ?? now;
}

/** What the storefront shows when the operator has not overridden it. */
export function seoTitleFor(post: { title: string; metaTitle: string | null }): string {
  return post.metaTitle?.trim() || post.title;
}

export function seoDescriptionFor(post: { excerpt: string; metaDescription: string | null }): string {
  return (post.metaDescription?.trim() || post.excerpt || '').slice(0, MAX_META_DESCRIPTION);
}
