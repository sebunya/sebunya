import { describe, expect, it, beforeEach } from 'vitest';
import {
  slugifyTitle, canPublish, validateBlogPost, readingMinutes, countWords,
  resolvePublishedAt, seoTitleFor, seoDescriptionFor, MIN_PUBLISHABLE_BODY_WORDS,
} from '../../apps/api/src/domain/blog/BlogPost';
import {
  CreatePostUseCase, UpdatePostUseCase, PublishPostUseCase, UnpublishPostUseCase, ListPublishedPostsUseCase,
} from '../../apps/api/src/application/use-cases/blog/BlogUseCases';
import type { IBlogRepository, BlogPostRecord } from '../../apps/api/src/application/ports/IBlogRepository';

const ARTICLE = 'word '.repeat(MIN_PUBLISHABLE_BODY_WORDS + 20);

class InMemoryBlogRepo implements IBlogRepository {
  posts: BlogPostRecord[] = [];
  related = new Map<string, string[]>();
  private seq = 0;

  async listPublished() { return this.posts.filter((p) => p.status === 'PUBLISHED'); }
  async countPublished() { return this.posts.filter((p) => p.status === 'PUBLISHED').length; }
  async listAll() { return this.posts; }
  async findBySlug(slug: string, opts: { includeUnpublished?: boolean } = {}) {
    return this.posts.find((p) => p.slug === slug && (opts.includeUnpublished || p.status === 'PUBLISHED')) ?? null;
  }
  async findById(id: string) { return this.posts.find((p) => p.id === id) ?? null; }
  async slugExists(slug: string, excludeId?: string) { return this.posts.some((p) => p.slug === slug && p.id !== excludeId); }
  async create(input: any) {
    const post: BlogPostRecord = { ...input, id: `id-${++this.seq}`, createdAt: new Date(), updatedAt: new Date() };
    this.posts.push(post);
    return post;
  }
  async update(id: string, input: any) {
    const post = this.posts.find((p) => p.id === id);
    if (!post) return null;
    Object.assign(post, input, { updatedAt: new Date() });
    return post;
  }
  async remove(id: string) {
    const before = this.posts.length;
    this.posts = this.posts.filter((p) => p.id !== id);
    return this.posts.length < before;
  }
  async setRelatedProducts(postId: string, ids: string[]) { this.related.set(postId, ids); }
  async relatedProducts() { return []; }
  async relatedProductIds(postId: string) { return this.related.get(postId) ?? []; }
}

let repo: InMemoryBlogRepo;
beforeEach(() => { repo = new InMemoryBlogRepo(); });

const draft = (over: Partial<Record<string, unknown>> = {}) => ({
  title: 'How to spot a fake charger',
  excerpt: 'Four checks that take ten seconds.',
  body: ARTICLE,
  authorId: null,
  ...over,
});

describe('a slug becomes a permanent public address', () => {
  it('is lowercase, ascii and hyphenated', () => {
    expect(slugifyTitle('How to Spot a FAKE Charger!')).toBe('how-to-spot-a-fake-charger');
  });
  it('strips accents rather than emitting them into a URL', () => {
    expect(slugifyTitle('Café Déjà vu')).toBe('cafe-deja-vu');
  });
  it('never begins or ends with a hyphen', () => {
    expect(slugifyTitle('  --- hello ---  ')).toBe('hello');
  });
  it('a title with no letters or numbers is refused rather than given an empty URL', () => {
    const result = validateBlogPost({ title: '!!! ???', excerpt: '', body: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SLUG_INVALID');
  });
});

describe('publishing is the gate, not saving', () => {
  it('a draft may be incomplete — that is what a draft is for', async () => {
    const result = await new CreatePostUseCase(repo).execute(draft({ excerpt: '', body: '' }) as never);
    expect(result.ok).toBe(true);
  });

  it('nothing is public on first save', async () => {
    const result = await new CreatePostUseCase(repo).execute(draft() as never);
    expect(result.ok && result.value.status).toBe('DRAFT');
    expect(result.ok && result.value.publishedAt).toBeNull();
    expect(await repo.countPublished()).toBe(0);
  });

  it('a stub cannot be published', () => {
    const gate = canPublish({ title: 'T', excerpt: 'S', body: 'too short' });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe('BODY_TOO_SHORT');
  });

  it('an article without a summary cannot be published — it is what Google shows', () => {
    const gate = canPublish({ title: 'T', excerpt: '   ', body: ARTICLE });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe('EXCERPT_REQUIRED');
  });

  it('a cover image without alt text cannot be published', () => {
    const gate = canPublish({ title: 'T', excerpt: 'S', body: ARTICLE, coverImageUrl: 'https://x/y.jpg', coverImageAlt: '' });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.code).toBe('COVER_ALT_REQUIRED');
  });

  it('a complete article publishes and becomes visible', async () => {
    const created = await new CreatePostUseCase(repo).execute(draft() as never);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const published = await new PublishPostUseCase(repo).execute(created.value.id);
    expect(published.ok).toBe(true);
    expect(await repo.countPublished()).toBe(1);
  });
});

describe('dates and addresses do not lie', () => {
  it('the publish date is stamped once and never moved by a re-publish', async () => {
    const created = await new CreatePostUseCase(repo).execute(draft() as never);
    if (!created.ok) throw new Error('setup');
    const first = new Date('2026-01-01T00:00:00Z');
    await new PublishPostUseCase(repo).execute(created.value.id, first);
    await new UnpublishPostUseCase(repo).execute(created.value.id);
    await new PublishPostUseCase(repo).execute(created.value.id, new Date('2026-06-01T00:00:00Z'));
    expect((await repo.findById(created.value.id))?.publishedAt?.toISOString()).toBe(first.toISOString());
  });

  it('resolvePublishedAt keeps an existing date and stamps a missing one', () => {
    const existing = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-09-09T00:00:00Z');
    expect(resolvePublishedAt(existing, now)).toBe(existing);
    expect(resolvePublishedAt(null, now)).toBe(now);
  });

  it('a published article keeps its URL when the title is edited', async () => {
    const created = await new CreatePostUseCase(repo).execute(draft() as never);
    if (!created.ok) throw new Error('setup');
    await new PublishPostUseCase(repo).execute(created.value.id);
    const originalSlug = created.value.slug;
    const updated = await new UpdatePostUseCase(repo).execute(created.value.id, {
      title: 'A completely different title', excerpt: 'Still summarised.', body: ARTICLE,
    });
    expect(updated.ok && updated.value.slug).toBe(originalSlug);
    expect(updated.ok && updated.value.title).toBe('A completely different title');
  });

  it('a draft may still change its address, because nothing links to it yet', async () => {
    const created = await new CreatePostUseCase(repo).execute(draft() as never);
    if (!created.ok) throw new Error('setup');
    const updated = await new UpdatePostUseCase(repo).execute(created.value.id, {
      title: 'Renamed while unpublished', excerpt: 'x', body: ARTICLE,
    });
    expect(updated.ok && updated.value.slug).toBe('renamed-while-unpublished');
  });

  it('two articles with the same title get different addresses', async () => {
    const uc = new CreatePostUseCase(repo);
    const a = await uc.execute(draft() as never);
    const b = await uc.execute(draft() as never);
    expect(a.ok && b.ok && a.value.slug).not.toBe(b.ok ? b.value.slug : '');
    expect(b.ok && b.value.slug.endsWith('-2')).toBe(true);
  });

  it('editing a LIVE article cannot silently turn it into a stub', async () => {
    const created = await new CreatePostUseCase(repo).execute(draft() as never);
    if (!created.ok) throw new Error('setup');
    await new PublishPostUseCase(repo).execute(created.value.id);
    const gutted = await new UpdatePostUseCase(repo).execute(created.value.id, {
      title: 'Still here', excerpt: 'Summary', body: 'nothing much',
    });
    expect(gutted.ok).toBe(false);
    expect((await repo.findById(created.value.id))?.body).toBe(ARTICLE);
  });

  it('unpublishing keeps the original date so re-publishing does not fake freshness', async () => {
    const created = await new CreatePostUseCase(repo).execute(draft() as never);
    if (!created.ok) throw new Error('setup');
    await new PublishPostUseCase(repo).execute(created.value.id, new Date('2026-02-02T00:00:00Z'));
    await new UnpublishPostUseCase(repo).execute(created.value.id, 'ARCHIVED');
    const post = await repo.findById(created.value.id);
    expect(post?.status).toBe('ARCHIVED');
    expect(post?.publishedAt?.toISOString()).toBe('2026-02-02T00:00:00.000Z');
  });
});

describe('what the reader and the crawler are told', () => {
  it('the index never ships article bodies', async () => {
    const created = await new CreatePostUseCase(repo).execute(draft() as never);
    if (!created.ok) throw new Error('setup');
    await new PublishPostUseCase(repo).execute(created.value.id);
    const listed = await new ListPublishedPostsUseCase(repo).execute();
    expect(listed.posts).toHaveLength(1);
    expect(Object.keys(listed.posts[0])).not.toContain('body');
  });

  it('drafts never appear in the public list', async () => {
    await new CreatePostUseCase(repo).execute(draft() as never);
    const listed = await new ListPublishedPostsUseCase(repo).execute();
    expect(listed.posts).toHaveLength(0);
    expect(listed.total).toBe(0);
  });

  it('SEO fields fall back to the article rather than going blank', () => {
    expect(seoTitleFor({ title: 'Real title', metaTitle: null })).toBe('Real title');
    expect(seoTitleFor({ title: 'Real title', metaTitle: '  Override ' })).toBe('Override');
    expect(seoDescriptionFor({ excerpt: 'The summary', metaDescription: null })).toBe('The summary');
  });

  it('reading time is honest and never zero', () => {
    expect(countWords('one two three')).toBe(3);
    expect(readingMinutes('word')).toBe(1);
    expect(readingMinutes('word '.repeat(400))).toBe(2);
  });

  it('related products are capped, deduplicated and stored', async () => {
    const ids = ['a', 'a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const created = await new CreatePostUseCase(repo).execute(draft({ relatedProductIds: ids }) as never);
    if (!created.ok) throw new Error('setup');
    const stored = await repo.relatedProductIds(created.value.id);
    expect(stored).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});
