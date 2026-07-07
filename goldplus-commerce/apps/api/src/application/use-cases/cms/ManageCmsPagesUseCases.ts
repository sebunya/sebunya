import {
  CmsPageStatus,
  CMS_PAGE_STATUSES,
  isValidCmsStatusTransition,
  validateCmsPageContent,
} from '../../../domain/cms/CmsPage';
import { ICmsPageRepository, PersistedCmsPage, CmsPageRevision } from '../../ports/ICmsPageRepository';

export type CreateCmsPageResult =
  | { ok: true; page: PersistedCmsPage }
  | { ok: false; code: 'BAD_SLUG' | 'BAD_TITLE' | 'BAD_BODY' | 'DUPLICATE_SLUG'; message: string };

export class CreateCmsPageUseCase {
  constructor(private readonly pages: ICmsPageRepository) {}

  async execute(input: {
    slug: string;
    title: string;
    body: string;
    excerpt?: string | null;
    metaTitle?: string | null;
    metaDescription?: string | null;
    editedBy: string | null;
  }): Promise<CreateCmsPageResult> {
    const validation = validateCmsPageContent(input);
    if (!validation.ok) return { ok: false, code: validation.code, message: validation.message };

    const existing = await this.pages.findBySlug(validation.content.slug);
    if (existing) {
      return { ok: false, code: 'DUPLICATE_SLUG', message: `A page with slug "${validation.content.slug}" already exists.` };
    }

    const page = await this.pages.create(validation.content, input.editedBy);
    return { ok: true, page };
  }
}

export type UpdateCmsPageResult =
  | { ok: true; page: PersistedCmsPage }
  | { ok: false; code: 'NOT_FOUND' | 'BAD_TITLE' | 'BAD_BODY' | 'BAD_SLUG'; message: string };

export class UpdateCmsPageUseCase {
  constructor(private readonly pages: ICmsPageRepository) {}

  async execute(input: {
    pageId: string;
    title: string;
    body: string;
    excerpt?: string | null;
    metaTitle?: string | null;
    metaDescription?: string | null;
    editedBy: string | null;
  }): Promise<UpdateCmsPageResult> {
    const current = await this.pages.findById(input.pageId);
    if (!current) return { ok: false, code: 'NOT_FOUND', message: 'Page not found.' };

    // Slug is immutable after creation (stable URLs); validate the rest.
    const validation = validateCmsPageContent({ ...input, slug: current.slug });
    if (!validation.ok) return { ok: false, code: validation.code, message: validation.message };

    const { slug: _slug, ...content } = validation.content;
    const page = await this.pages.updateContent(input.pageId, content, input.editedBy);
    if (!page) return { ok: false, code: 'NOT_FOUND', message: 'Page disappeared during update.' };
    return { ok: true, page };
  }
}

export type ChangeCmsPageStatusResult =
  | { ok: true; page: PersistedCmsPage }
  | { ok: false; code: 'NOT_FOUND' | 'BAD_STATUS' | 'BAD_TRANSITION' | 'BAD_WINDOW'; message: string };

export class ChangeCmsPageStatusUseCase {
  constructor(private readonly pages: ICmsPageRepository) {}

  async execute(input: {
    pageId: string;
    status: string;
    publishAt?: string | null;
    expireAt?: string | null;
    editedBy: string | null;
  }): Promise<ChangeCmsPageStatusResult> {
    const status = (input.status || '').trim().toUpperCase() as CmsPageStatus;
    if (!CMS_PAGE_STATUSES.includes(status)) {
      return { ok: false, code: 'BAD_STATUS', message: `Status must be one of ${CMS_PAGE_STATUSES.join(', ')}.` };
    }

    const page = await this.pages.findById(input.pageId);
    if (!page) return { ok: false, code: 'NOT_FOUND', message: 'Page not found.' };

    if (!isValidCmsStatusTransition(page.status, status)) {
      return { ok: false, code: 'BAD_TRANSITION', message: `Cannot move page from ${page.status} to ${status}.` };
    }

    let publishAt: Date | null = null;
    let expireAt: Date | null = null;
    if (status === 'PUBLISHED') {
      if (input.publishAt) {
        publishAt = new Date(input.publishAt);
        if (Number.isNaN(publishAt.getTime())) {
          return { ok: false, code: 'BAD_WINDOW', message: 'publishAt must be a valid ISO date.' };
        }
      }
      if (input.expireAt) {
        expireAt = new Date(input.expireAt);
        if (Number.isNaN(expireAt.getTime())) {
          return { ok: false, code: 'BAD_WINDOW', message: 'expireAt must be a valid ISO date.' };
        }
      }
      if (publishAt && expireAt && expireAt <= publishAt) {
        return { ok: false, code: 'BAD_WINDOW', message: 'expireAt must be after publishAt.' };
      }
    }

    const updated = await this.pages.updateStatus(input.pageId, status, { publishAt, expireAt }, input.editedBy);
    if (!updated) return { ok: false, code: 'NOT_FOUND', message: 'Page disappeared during update.' };
    return { ok: true, page: updated };
  }
}

export class ListCmsPagesUseCase {
  constructor(private readonly pages: ICmsPageRepository) {}
  async execute(): Promise<PersistedCmsPage[]> {
    return this.pages.list();
  }
}

export class ListCmsPageRevisionsUseCase {
  constructor(private readonly pages: ICmsPageRepository) {}
  async execute(pageId: string): Promise<CmsPageRevision[]> {
    return this.pages.listRevisions(pageId);
  }
}

export type RevertCmsPageResult =
  | { ok: true; page: PersistedCmsPage }
  | { ok: false; code: 'NOT_FOUND' | 'REVISION_NOT_FOUND'; message: string };

/** Reverting re-applies an old revision's content as a NEW version — history is never rewritten. */
export class RevertCmsPageUseCase {
  constructor(private readonly pages: ICmsPageRepository) {}

  async execute(input: { pageId: string; version: number; editedBy: string | null }): Promise<RevertCmsPageResult> {
    const page = await this.pages.findById(input.pageId);
    if (!page) return { ok: false, code: 'NOT_FOUND', message: 'Page not found.' };

    const revision = await this.pages.findRevision(input.pageId, input.version);
    if (!revision) return { ok: false, code: 'REVISION_NOT_FOUND', message: `Revision v${input.version} not found.` };

    const updated = await this.pages.updateContent(
      input.pageId,
      {
        title: revision.title,
        body: revision.body,
        excerpt: revision.excerpt,
        metaTitle: revision.metaTitle,
        metaDescription: revision.metaDescription,
      },
      input.editedBy
    );
    if (!updated) return { ok: false, code: 'NOT_FOUND', message: 'Page disappeared during revert.' };
    return { ok: true, page: updated };
  }
}
