import { describe, expect, it } from 'vitest';
import {
  validateCmsPageContent,
  isValidCmsStatusTransition,
  isCmsPageVisible,
} from '../../apps/api/src/domain/cms/CmsPage';
import {
  CreateCmsPageUseCase,
  UpdateCmsPageUseCase,
  ChangeCmsPageStatusUseCase,
  RevertCmsPageUseCase,
} from '../../apps/api/src/application/use-cases/cms/ManageCmsPagesUseCases';
import { GetPublishedCmsPageUseCase } from '../../apps/api/src/application/use-cases/cms/GetPublishedCmsPageUseCase';
import {
  ICmsPageRepository,
  PersistedCmsPage,
  CmsPageRevision,
} from '../../apps/api/src/application/ports/ICmsPageRepository';
import { CmsPageContent, CmsPageStatus } from '../../apps/api/src/domain/cms/CmsPage';

class InMemoryCmsRepo implements ICmsPageRepository {
  private pages: PersistedCmsPage[] = [];
  private revisions: CmsPageRevision[] = [];

  async create(content: CmsPageContent, editedBy: string | null): Promise<PersistedCmsPage> {
    const now = new Date();
    const page: PersistedCmsPage = {
      ...content,
      id: `page-${this.pages.length + 1}`,
      status: 'DRAFT',
      publishAt: null,
      expireAt: null,
      currentVersion: 1,
      updatedBy: editedBy,
      createdAt: now,
      updatedAt: now,
    };
    this.pages.push(page);
    this.revisions.push({
      id: `rev-${this.revisions.length + 1}`,
      pageId: page.id,
      version: 1,
      title: content.title,
      body: content.body,
      excerpt: content.excerpt,
      metaTitle: content.metaTitle,
      metaDescription: content.metaDescription,
      editedBy,
      createdAt: now,
    });
    return page;
  }

  async updateContent(pageId: string, content: Omit<CmsPageContent, 'slug'>, editedBy: string | null) {
    const page = this.pages.find((p) => p.id === pageId);
    if (!page) return null;
    page.currentVersion += 1;
    Object.assign(page, content);
    page.updatedAt = new Date();
    this.revisions.push({
      id: `rev-${this.revisions.length + 1}`,
      pageId,
      version: page.currentVersion,
      title: content.title,
      body: content.body,
      excerpt: content.excerpt,
      metaTitle: content.metaTitle,
      metaDescription: content.metaDescription,
      editedBy,
      createdAt: new Date(),
    });
    return page;
  }

  async updateStatus(
    pageId: string,
    status: CmsPageStatus,
    window: { publishAt: Date | null; expireAt: Date | null }
  ) {
    const page = this.pages.find((p) => p.id === pageId);
    if (!page) return null;
    page.status = status;
    page.publishAt = window.publishAt;
    page.expireAt = window.expireAt;
    page.updatedAt = new Date();
    return page;
  }

  async findBySlug(slug: string) {
    return this.pages.find((p) => p.slug === slug) ?? null;
  }
  async findById(pageId: string) {
    return this.pages.find((p) => p.id === pageId) ?? null;
  }
  async list() {
    return [...this.pages];
  }
  async listRevisions(pageId: string) {
    return this.revisions.filter((r) => r.pageId === pageId).sort((a, b) => b.version - a.version);
  }
  async findRevision(pageId: string, version: number) {
    return this.revisions.find((r) => r.pageId === pageId && r.version === version) ?? null;
  }
}

describe('validateCmsPageContent', () => {
  it('accepts valid content and normalises the slug', () => {
    const r = validateCmsPageContent({ slug: 'About-Us', title: 'About', body: 'Hello world' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content.slug).toBe('about-us');
  });

  it('rejects bad slugs, empty titles, and empty bodies', () => {
    expect(validateCmsPageContent({ slug: 'a', title: 'T', body: 'B' }).ok).toBe(false);
    expect(validateCmsPageContent({ slug: 'ok-slug', title: '', body: 'B' }).ok).toBe(false);
    expect(validateCmsPageContent({ slug: 'ok-slug', title: 'T', body: '' }).ok).toBe(false);
  });
});

describe('CMS status transitions & visibility', () => {
  it('enforces the lifecycle', () => {
    expect(isValidCmsStatusTransition('DRAFT', 'PUBLISHED')).toBe(true);
    expect(isValidCmsStatusTransition('PUBLISHED', 'ARCHIVED')).toBe(true);
    expect(isValidCmsStatusTransition('ARCHIVED', 'PUBLISHED')).toBe(false);
    expect(isValidCmsStatusTransition('DRAFT', 'DRAFT')).toBe(false);
  });

  it('computes public visibility from status and window', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    expect(isCmsPageVisible({ status: 'DRAFT', publishAt: null, expireAt: null }, now)).toBe(false);
    expect(isCmsPageVisible({ status: 'PUBLISHED', publishAt: null, expireAt: null }, now)).toBe(true);
    expect(
      isCmsPageVisible({ status: 'PUBLISHED', publishAt: new Date('2026-07-01T00:00:00Z'), expireAt: null }, now)
    ).toBe(false); // scheduled for the future
    expect(
      isCmsPageVisible({ status: 'PUBLISHED', publishAt: null, expireAt: new Date('2026-05-01T00:00:00Z') }, now)
    ).toBe(false); // already expired
  });
});

describe('CMS use cases', () => {
  it('creates, rejects duplicate slug, versions on update, and reverts as a new version', async () => {
    const repo = new InMemoryCmsRepo();
    const create = new CreateCmsPageUseCase(repo);
    const created = await create.execute({ slug: 'about', title: 'About v1', body: 'First body', editedBy: 'admin-1' });
    expect(created.ok).toBe(true);

    const dup = await create.execute({ slug: 'about', title: 'x', body: 'y', editedBy: 'admin-1' });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe('DUPLICATE_SLUG');

    const pageId = created.ok ? created.page.id : '';
    const update = new UpdateCmsPageUseCase(repo);
    const updated = await update.execute({ pageId, title: 'About v2', body: 'Second body', editedBy: 'admin-1' });
    expect(updated.ok).toBe(true);
    if (updated.ok) expect(updated.page.currentVersion).toBe(2);

    const revert = new RevertCmsPageUseCase(repo);
    const reverted = await revert.execute({ pageId, version: 1, editedBy: 'admin-1' });
    expect(reverted.ok).toBe(true);
    if (reverted.ok) {
      expect(reverted.page.currentVersion).toBe(3); // revert appends, never rewrites
      expect(reverted.page.title).toBe('About v1');
    }
  });

  it('only serves published pages inside their window to the public', async () => {
    const repo = new InMemoryCmsRepo();
    const create = new CreateCmsPageUseCase(repo);
    const created = await create.execute({ slug: 'promo', title: 'Promo', body: 'Body', editedBy: null });
    const pageId = created.ok ? created.page.id : '';

    const getPublished = new GetPublishedCmsPageUseCase(repo);
    expect(await getPublished.execute('promo')).toBeNull(); // still DRAFT

    const changeStatus = new ChangeCmsPageStatusUseCase(repo);
    const published = await changeStatus.execute({ pageId, status: 'PUBLISHED', editedBy: null });
    expect(published.ok).toBe(true);

    const visible = await getPublished.execute('promo');
    expect(visible?.slug).toBe('promo');
  });

  it('rejects a publish window where expire precedes publish', async () => {
    const repo = new InMemoryCmsRepo();
    const create = new CreateCmsPageUseCase(repo);
    const created = await create.execute({ slug: 'sale', title: 'Sale', body: 'Body', editedBy: null });
    const pageId = created.ok ? created.page.id : '';
    const changeStatus = new ChangeCmsPageStatusUseCase(repo);
    const result = await changeStatus.execute({
      pageId,
      status: 'PUBLISHED',
      publishAt: '2026-07-01T00:00:00Z',
      expireAt: '2026-06-01T00:00:00Z',
      editedBy: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('BAD_WINDOW');
  });
});
