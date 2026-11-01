import { IBlogRepository, BlogPostRecord, BlogRelatedProduct } from '../../ports/IBlogRepository';
import {
  BlogPostInput,
  canPublish,
  resolvePublishedAt,
  slugifyTitle,
  validateBlogPost,
  readingMinutes,
  seoDescriptionFor,
  seoTitleFor,
} from '../../../domain/blog/BlogPost';

export type BlogResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

export interface PublicBlogPost {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  publishedAt: string | null;
  updatedAt: string;
  authorName: string;
  readingMinutes: number;
  seoTitle: string;
  seoDescription: string;
  relatedProducts: BlogRelatedProduct[];
}

const toPublic = (post: BlogPostRecord, relatedProducts: BlogRelatedProduct[]): PublicBlogPost => ({
  slug: post.slug,
  title: post.title,
  excerpt: post.excerpt,
  body: post.body,
  coverImageUrl: post.coverImageUrl,
  coverImageAlt: post.coverImageAlt,
  publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
  updatedAt: post.updatedAt.toISOString(),
  authorName: post.authorName,
  readingMinutes: readingMinutes(post.body),
  seoTitle: seoTitleFor(post),
  seoDescription: seoDescriptionFor(post),
  relatedProducts,
});

/** The public index. Only PUBLISHED articles ever leave this use case. */
export class ListPublishedPostsUseCase {
  constructor(private readonly repo: IBlogRepository) {}

  async execute(opts: { limit?: number; offset?: number } = {}): Promise<{ posts: Array<Omit<PublicBlogPost, 'body' | 'relatedProducts'>>; total: number }> {
    const [rows, total] = await Promise.all([this.repo.listPublished(opts), this.repo.countPublished()]);
    return {
      // The list never ships article bodies. A twenty-card index carrying every
      // full article is a slow page for no reader benefit.
      posts: rows.map((post) => {
        const { body: _body, relatedProducts: _related, ...rest } = toPublic(post, []);
        return rest;
      }),
      total,
    };
  }
}

export class GetPublishedPostUseCase {
  constructor(private readonly repo: IBlogRepository) {}

  async execute(slug: string): Promise<PublicBlogPost | null> {
    const post = await this.repo.findBySlug(slug);
    if (!post) return null;
    return toPublic(post, await this.repo.relatedProducts(post.id));
  }
}

/** Admin read: a draft can be previewed by its author before anyone else sees it. */
export class GetPostForAdminUseCase {
  constructor(private readonly repo: IBlogRepository) {}

  async execute(id: string): Promise<{ post: BlogPostRecord; relatedProductIds: string[] } | null> {
    const post = await this.repo.findById(id);
    if (!post) return null;
    return { post, relatedProductIds: await this.repo.relatedProductIds(post.id) };
  }
}

async function uniqueSlug(repo: IBlogRepository, base: string, excludeId?: string): Promise<string> {
  if (!(await repo.slugExists(base, excludeId))) return base;
  // A collision appends a counter rather than overwriting someone else's URL.
  for (let n = 2; n <= 50; n += 1) {
    const candidate = `${base.slice(0, 195)}-${n}`;
    if (!(await repo.slugExists(candidate, excludeId))) return candidate;
  }
  return `${base.slice(0, 190)}-${Date.now().toString(36)}`;
}

export class CreatePostUseCase {
  constructor(private readonly repo: IBlogRepository) {}

  async execute(input: BlogPostInput & { authorId: string | null; authorName?: string }): Promise<BlogResult<BlogPostRecord>> {
    const validated = validateBlogPost(input);
    if (!validated.ok) return validated;
    const value = validated.value;
    const slug = await uniqueSlug(this.repo, value.slug);

    // Always created as a DRAFT. Publishing is a separate, deliberate act with
    // its own gate; nothing reaches the public on the first save.
    const post = await this.repo.create({
      slug,
      title: value.title,
      excerpt: value.excerpt,
      body: value.body,
      coverImageUrl: value.coverImageUrl,
      coverImageAlt: value.coverImageAlt,
      status: 'DRAFT',
      metaTitle: value.metaTitle,
      metaDescription: value.metaDescription,
      publishedAt: null,
      authorId: input.authorId,
      authorName: input.authorName?.trim() || 'GoldPlus',
    });
    await this.repo.setRelatedProducts(post.id, value.relatedProductIds);
    return { ok: true, value: post };
  }
}

export class UpdatePostUseCase {
  constructor(private readonly repo: IBlogRepository) {}

  async execute(id: string, input: BlogPostInput): Promise<BlogResult<BlogPostRecord>> {
    const existing = await this.repo.findById(id);
    if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'That article no longer exists.' };
    const validated = validateBlogPost(input);
    if (!validated.ok) return validated;
    const value = validated.value;

    // A PUBLISHED article keeps its URL. Changing the slug of a live page
    // breaks every link and share that already points at it; the operator can
    // still rename the title freely.
    const slug = existing.status === 'PUBLISHED'
      ? existing.slug
      : await uniqueSlug(this.repo, value.slug, id);

    // Editing a published article must not silently republish a stub: if the
    // edit would fail the publish gate, it is refused rather than left live.
    if (existing.status === 'PUBLISHED') {
      const gate = canPublish({ ...value });
      if (!gate.ok) return gate;
    }

    const updated = await this.repo.update(id, {
      slug,
      title: value.title,
      excerpt: value.excerpt,
      body: value.body,
      coverImageUrl: value.coverImageUrl,
      coverImageAlt: value.coverImageAlt,
      metaTitle: value.metaTitle,
      metaDescription: value.metaDescription,
    });
    if (!updated) return { ok: false, code: 'NOT_FOUND', message: 'That article no longer exists.' };
    await this.repo.setRelatedProducts(id, value.relatedProductIds);
    return { ok: true, value: updated };
  }
}

export class PublishPostUseCase {
  constructor(private readonly repo: IBlogRepository) {}

  async execute(id: string, now: Date = new Date()): Promise<BlogResult<BlogPostRecord>> {
    const post = await this.repo.findById(id);
    if (!post) return { ok: false, code: 'NOT_FOUND', message: 'That article no longer exists.' };
    const gate = canPublish(post);
    if (!gate.ok) return gate;

    const updated = await this.repo.update(id, {
      status: 'PUBLISHED',
      // First publish stamps the date; a re-publish keeps the original.
      publishedAt: resolvePublishedAt(post.publishedAt, now),
    });
    return updated
      ? { ok: true, value: updated }
      : { ok: false, code: 'NOT_FOUND', message: 'That article no longer exists.' };
  }
}

export class UnpublishPostUseCase {
  constructor(private readonly repo: IBlogRepository) {}

  async execute(id: string, status: 'DRAFT' | 'ARCHIVED' = 'DRAFT'): Promise<BlogResult<BlogPostRecord>> {
    const post = await this.repo.findById(id);
    if (!post) return { ok: false, code: 'NOT_FOUND', message: 'That article no longer exists.' };
    // publishedAt is deliberately kept. Re-publishing later restores the
    // original date rather than pretending the article is new.
    const updated = await this.repo.update(id, { status });
    return updated
      ? { ok: true, value: updated }
      : { ok: false, code: 'NOT_FOUND', message: 'That article no longer exists.' };
  }
}

export class DeletePostUseCase {
  constructor(private readonly repo: IBlogRepository) {}

  async execute(id: string): Promise<BlogResult<{ id: string }>> {
    const removed = await this.repo.remove(id);
    return removed
      ? { ok: true, value: { id } }
      : { ok: false, code: 'NOT_FOUND', message: 'That article no longer exists.' };
  }
}

export { slugifyTitle };
