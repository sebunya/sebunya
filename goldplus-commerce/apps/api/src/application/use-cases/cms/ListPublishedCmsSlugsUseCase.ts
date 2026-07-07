import { isCmsPageVisible } from '../../../domain/cms/CmsPage';
import { ICmsPageRepository } from '../../ports/ICmsPageRepository';

export interface PublishedCmsSlug {
  slug: string;
  updatedAt: string;
}

/** Slugs of pages currently visible to the public — powers the sitemap. */
export class ListPublishedCmsSlugsUseCase {
  constructor(private readonly pages: ICmsPageRepository) {}

  async execute(now: Date = new Date()): Promise<PublishedCmsSlug[]> {
    const pages = await this.pages.list();
    return pages
      .filter((p) => isCmsPageVisible(p, now))
      .map((p) => ({ slug: p.slug, updatedAt: p.updatedAt.toISOString() }));
  }
}
