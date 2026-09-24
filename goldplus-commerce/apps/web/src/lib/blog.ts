import { apiBase } from './api';
import type { ApiResponse } from '@goldplus/shared';

export interface BlogRelatedProduct {
  id: string;
  slug: string;
  name: string;
  categoryName: string | null;
  retailPriceUgx: number | null;
  floorPriceUgx: number | null;
  primaryImageUrl: string | null;
}

export interface BlogCard {
  slug: string;
  title: string;
  excerpt: string;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  publishedAt: string | null;
  updatedAt: string;
  authorName: string;
  readingMinutes: number;
  seoTitle: string;
  seoDescription: string;
}

export interface BlogArticle extends BlogCard {
  body: string;
  relatedProducts: BlogRelatedProduct[];
}

/**
 * The blog is additive: if the service is unreachable the page says so and the
 * rest of the site is unaffected. It never invents an article.
 *
 * `error: true` marks "could not ask", which is NOT "nothing published": the
 * index used to turn noindex and the blog sitemap used to empty itself on any
 * API timeout, so a slow moment could drop the published blog from Google.
 */
export async function fetchPublishedPosts(limit = 20, offset = 0): Promise<{ posts: BlogCard[]; total: number; error?: true }> {
  const unavailable = { posts: [] as BlogCard[], total: 0, error: true as const };
  try {
    const res = await fetch(`${apiBase}/blog?limit=${limit}&offset=${offset}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return unavailable;
    const body = (await res.json()) as ApiResponse<{ posts: BlogCard[]; total: number }>;
    if (!body.success || !body.data) return unavailable;
    return { posts: Array.isArray(body.data.posts) ? body.data.posts : [], total: Number(body.data.total ?? 0) };
  } catch {
    return unavailable;
  }
}

export async function fetchPost(slug: string): Promise<BlogArticle | null> {
  try {
    const res = await fetch(`${apiBase}/blog/${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as ApiResponse<BlogArticle>;
    return body.success && body.data ? body.data : null;
  } catch {
    return null;
  }
}

/** Kampala time, spelled out — the shop's own timezone, not the server's. */
export function formatArticleDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Kampala',
  });
}
