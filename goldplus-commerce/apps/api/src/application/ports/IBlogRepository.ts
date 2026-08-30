import { BlogStatus } from '../../domain/blog/BlogPost';

export interface BlogPostRecord {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  status: BlogStatus;
  metaTitle: string | null;
  metaDescription: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
  authorName: string;
}

/** A product an article recommends, in the shape the storefront card needs. */
export interface BlogRelatedProduct {
  id: string;
  slug: string;
  name: string;
  categoryName: string | null;
  retailPriceUgx: number | null;
  primaryImageUrl: string | null;
}

export interface IBlogRepository {
  listPublished(opts?: { limit?: number; offset?: number }): Promise<BlogPostRecord[]>;
  countPublished(): Promise<number>;
  listAll(opts?: { limit?: number; offset?: number }): Promise<BlogPostRecord[]>;
  findBySlug(slug: string, opts?: { includeUnpublished?: boolean }): Promise<BlogPostRecord | null>;
  findById(id: string): Promise<BlogPostRecord | null>;
  slugExists(slug: string, excludeId?: string): Promise<boolean>;
  create(input: Omit<BlogPostRecord, 'id' | 'createdAt' | 'updatedAt'> & { authorId: string | null }): Promise<BlogPostRecord>;
  update(id: string, input: Partial<Omit<BlogPostRecord, 'id' | 'createdAt'>>): Promise<BlogPostRecord | null>;
  remove(id: string): Promise<boolean>;
  setRelatedProducts(postId: string, productIds: string[]): Promise<void>;
  relatedProducts(postId: string): Promise<BlogRelatedProduct[]>;
  relatedProductIds(postId: string): Promise<string[]>;
}
