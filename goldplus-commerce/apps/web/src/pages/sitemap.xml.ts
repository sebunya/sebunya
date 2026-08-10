import type { APIRoute } from 'astro';
import { sitemapIndexXml, xmlResponse } from '../lib/sitemap';

/**
 * U6 — /sitemap.xml is a sitemap INDEX. The real URL lists live in the child
 * sitemaps so products (DB-backed, real lastmod) and static pages evolve
 * independently.
 */
export const GET: APIRoute = async () => {
  return xmlResponse(
    sitemapIndexXml(['/sitemaps/static.xml', '/sitemaps/products.xml', '/sitemaps/categories.xml', '/sitemaps/hubs.xml']),
  );
};
