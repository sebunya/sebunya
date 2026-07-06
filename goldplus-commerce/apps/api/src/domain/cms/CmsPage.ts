/**
 * CMS pages — domain rules.
 *
 * Pages are written in a documented markdown subset, versioned on every
 * edit (append-only revisions), and published either immediately or on
 * a schedule (`publishAt`). Visibility is a pure function of status and
 * the publish/expire window so the public read path stays trivial.
 */

export type CmsPageStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export const CMS_PAGE_STATUSES: readonly CmsPageStatus[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/;
const MAX_TITLE = 160;
const MAX_BODY = 100_000;
const MAX_META_TITLE = 70;
const MAX_META_DESCRIPTION = 200;

export interface CmsPageContent {
  slug: string;
  title: string;
  body: string;
  excerpt: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
}

export type CmsPageValidation =
  | { ok: true; content: CmsPageContent }
  | { ok: false; code: 'BAD_SLUG' | 'BAD_TITLE' | 'BAD_BODY'; message: string };

export function validateCmsPageContent(input: {
  slug: string;
  title: string;
  body: string;
  excerpt?: string | null;
  metaTitle?: string | null;
  metaDescription?: string | null;
}): CmsPageValidation {
  const slug = (input.slug || '').trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      code: 'BAD_SLUG',
      message: 'Slug must be 3-80 chars of lowercase letters, digits, and hyphens (no leading/trailing hyphen).',
    };
  }

  const title = (input.title || '').trim();
  if (!title || title.length > MAX_TITLE) {
    return { ok: false, code: 'BAD_TITLE', message: `Title is required (max ${MAX_TITLE} chars).` };
  }

  const body = (input.body || '').trim();
  if (!body || body.length > MAX_BODY) {
    return { ok: false, code: 'BAD_BODY', message: `Body is required (max ${MAX_BODY} chars).` };
  }

  return {
    ok: true,
    content: {
      slug,
      title,
      body,
      excerpt: input.excerpt ? String(input.excerpt).trim().slice(0, 500) || null : null,
      metaTitle: input.metaTitle ? String(input.metaTitle).trim().slice(0, MAX_META_TITLE) || null : null,
      metaDescription: input.metaDescription
        ? String(input.metaDescription).trim().slice(0, MAX_META_DESCRIPTION) || null
        : null,
    },
  };
}

export function isValidCmsStatusTransition(from: CmsPageStatus, to: CmsPageStatus): boolean {
  if (from === to) return false;
  switch (from) {
    case 'DRAFT':
      return to === 'PUBLISHED' || to === 'ARCHIVED';
    case 'PUBLISHED':
      return to === 'DRAFT' || to === 'ARCHIVED';
    case 'ARCHIVED':
      return to === 'DRAFT';
  }
}

/**
 * A page is publicly visible when PUBLISHED and inside its optional
 * publish/expire window.
 */
export function isCmsPageVisible(
  page: { status: CmsPageStatus; publishAt: Date | null; expireAt: Date | null },
  now: Date
): boolean {
  if (page.status !== 'PUBLISHED') return false;
  if (page.publishAt && page.publishAt > now) return false;
  if (page.expireAt && page.expireAt <= now) return false;
  return true;
}
