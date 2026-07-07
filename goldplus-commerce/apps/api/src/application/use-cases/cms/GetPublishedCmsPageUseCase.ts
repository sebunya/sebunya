import { isCmsPageVisible } from '../../../domain/cms/CmsPage';
import { ICmsPageRepository } from '../../ports/ICmsPageRepository';

export interface PublishedCmsPageDto {
  slug: string;
  title: string;
  body: string;
  excerpt: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  updatedAt: string;
}

export class GetPublishedCmsPageUseCase {
  constructor(private readonly pages: ICmsPageRepository) {}

  async execute(slug: string, now: Date = new Date()): Promise<PublishedCmsPageDto | null> {
    const page = await this.pages.findBySlug((slug || '').trim().toLowerCase());
    if (!page || !isCmsPageVisible(page, now)) return null;
    return {
      slug: page.slug,
      title: page.title,
      body: page.body,
      excerpt: page.excerpt,
      metaTitle: page.metaTitle,
      metaDescription: page.metaDescription,
      updatedAt: page.updatedAt.toISOString(),
    };
  }
}
