import { CmsPageContent, CmsPageStatus } from '../../domain/cms/CmsPage';

export interface PersistedCmsPage extends CmsPageContent {
  id: string;
  status: CmsPageStatus;
  publishAt: Date | null;
  expireAt: Date | null;
  currentVersion: number;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CmsPageRevision {
  id: string;
  pageId: string;
  version: number;
  title: string;
  body: string;
  excerpt: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  editedBy: string | null;
  createdAt: Date;
}

export interface ICmsPageRepository {
  /** Creates the page at version 1 and writes revision 1 atomically. */
  create(content: CmsPageContent, editedBy: string | null): Promise<PersistedCmsPage>;
  /** Bumps the version and appends a revision atomically. */
  updateContent(
    pageId: string,
    content: Omit<CmsPageContent, 'slug'>,
    editedBy: string | null
  ): Promise<PersistedCmsPage | null>;
  updateStatus(
    pageId: string,
    status: CmsPageStatus,
    window: { publishAt: Date | null; expireAt: Date | null },
    editedBy: string | null
  ): Promise<PersistedCmsPage | null>;
  findBySlug(slug: string): Promise<PersistedCmsPage | null>;
  findById(pageId: string): Promise<PersistedCmsPage | null>;
  list(): Promise<PersistedCmsPage[]>;
  listRevisions(pageId: string): Promise<CmsPageRevision[]>;
  findRevision(pageId: string, version: number): Promise<CmsPageRevision | null>;
}
