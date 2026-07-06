import { desc, eq } from 'drizzle-orm';
import { db } from '../client';
import { cmsPages, cmsPageRevisions } from '../schema/cms';
import { ICmsPageRepository, PersistedCmsPage, CmsPageRevision } from '../../../application/ports/ICmsPageRepository';
import { CmsPageContent, CmsPageStatus } from '../../../domain/cms/CmsPage';

function rowToPage(row: typeof cmsPages.$inferSelect): PersistedCmsPage {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    excerpt: row.excerpt ?? null,
    metaTitle: row.metaTitle ?? null,
    metaDescription: row.metaDescription ?? null,
    status: row.status as CmsPageStatus,
    publishAt: row.publishAt ?? null,
    expireAt: row.expireAt ?? null,
    currentVersion: row.currentVersion,
    updatedBy: row.updatedBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToRevision(row: typeof cmsPageRevisions.$inferSelect): CmsPageRevision {
  return {
    id: row.id,
    pageId: row.pageId,
    version: row.version,
    title: row.title,
    body: row.body,
    excerpt: row.excerpt ?? null,
    metaTitle: row.metaTitle ?? null,
    metaDescription: row.metaDescription ?? null,
    editedBy: row.editedBy ?? null,
    createdAt: row.createdAt,
  };
}

export class DrizzleCmsPageRepository implements ICmsPageRepository {
  async create(content: CmsPageContent, editedBy: string | null): Promise<PersistedCmsPage> {
    return db.transaction(async (tx) => {
      const [page] = await tx
        .insert(cmsPages)
        .values({
          slug: content.slug,
          title: content.title,
          body: content.body,
          excerpt: content.excerpt,
          metaTitle: content.metaTitle,
          metaDescription: content.metaDescription,
          updatedBy: editedBy,
        })
        .returning();

      await tx.insert(cmsPageRevisions).values({
        pageId: page.id,
        version: 1,
        title: content.title,
        body: content.body,
        excerpt: content.excerpt,
        metaTitle: content.metaTitle,
        metaDescription: content.metaDescription,
        editedBy,
      });

      return rowToPage(page);
    });
  }

  async updateContent(
    pageId: string,
    content: Omit<CmsPageContent, 'slug'>,
    editedBy: string | null
  ): Promise<PersistedCmsPage | null> {
    return db.transaction(async (tx) => {
      const current = await tx.query.cmsPages.findFirst({ where: eq(cmsPages.id, pageId) });
      if (!current) return null;

      const nextVersion = current.currentVersion + 1;
      const [page] = await tx
        .update(cmsPages)
        .set({
          title: content.title,
          body: content.body,
          excerpt: content.excerpt,
          metaTitle: content.metaTitle,
          metaDescription: content.metaDescription,
          currentVersion: nextVersion,
          updatedBy: editedBy,
          updatedAt: new Date(),
        })
        .where(eq(cmsPages.id, pageId))
        .returning();

      await tx.insert(cmsPageRevisions).values({
        pageId,
        version: nextVersion,
        title: content.title,
        body: content.body,
        excerpt: content.excerpt,
        metaTitle: content.metaTitle,
        metaDescription: content.metaDescription,
        editedBy,
      });

      return rowToPage(page);
    });
  }

  async updateStatus(
    pageId: string,
    status: CmsPageStatus,
    window: { publishAt: Date | null; expireAt: Date | null },
    editedBy: string | null
  ): Promise<PersistedCmsPage | null> {
    const [page] = await db
      .update(cmsPages)
      .set({
        status,
        publishAt: window.publishAt,
        expireAt: window.expireAt,
        updatedBy: editedBy,
        updatedAt: new Date(),
      })
      .where(eq(cmsPages.id, pageId))
      .returning();
    return page ? rowToPage(page) : null;
  }

  async findBySlug(slug: string): Promise<PersistedCmsPage | null> {
    const row = await db.query.cmsPages.findFirst({ where: eq(cmsPages.slug, slug) });
    return row ? rowToPage(row) : null;
  }

  async findById(pageId: string): Promise<PersistedCmsPage | null> {
    const row = await db.query.cmsPages.findFirst({ where: eq(cmsPages.id, pageId) });
    return row ? rowToPage(row) : null;
  }

  async list(): Promise<PersistedCmsPage[]> {
    const rows = await db.query.cmsPages.findMany({ orderBy: [desc(cmsPages.updatedAt)] });
    return rows.map(rowToPage);
  }

  async listRevisions(pageId: string): Promise<CmsPageRevision[]> {
    const rows = await db.query.cmsPageRevisions.findMany({
      where: eq(cmsPageRevisions.pageId, pageId),
      orderBy: [desc(cmsPageRevisions.version)],
    });
    return rows.map(rowToRevision);
  }

  async findRevision(pageId: string, version: number): Promise<CmsPageRevision | null> {
    const row = await db.query.cmsPageRevisions.findFirst({
      where: (t, { and, eq }) => and(eq(t.pageId, pageId), eq(t.version, version)),
    });
    return row ? rowToRevision(row) : null;
  }
}
