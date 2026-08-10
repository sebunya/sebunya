import type { APIRoute } from 'astro';
import { STATIC_SITEMAP_PATHS, isIndexablePath, urlsetXml, xmlResponse } from '../../lib/sitemap';

/**
 * U6 — hand-listed static pages, indexable ones only. No lastmod: we do not
 * know when static copy last changed, and a fabricated `now()` teaches crawlers
 * to distrust every lastmod on the site.
 */
export const GET: APIRoute = async () => {
  return xmlResponse(urlsetXml(STATIC_SITEMAP_PATHS.filter(isIndexablePath).map((loc) => ({ loc }))));
};
