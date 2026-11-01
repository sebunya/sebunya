import type { APIRoute } from 'astro';
import { normalizeSearchParam } from '../lib/product-discovery';

/**
 * /search -> /shop, carrying the query.
 *
 * The storefront's search IS /shop: shop.astro reads `search` or `q`, filters
 * through the shared discovery filter and taxonomy, and already renders the
 * search title, the no-results state with its next actions, noindex,follow, and
 * the server-side search analytics. /search simply never existed, so a shared,
 * bookmarked or typed link to it 404'd.
 *
 * This forwards rather than renders. A second results page would mean two
 * search implementations to keep in step — one behind the header's suggestions
 * and results, another behind direct links — and they would disagree the first
 * time either changed.
 *
 * Every other parameter is preserved, so /search?q=charger&category=power keeps
 * its filters. 301, so clients and search engines consolidate on the one
 * canonical results URL instead of holding both.
 */
export const GET: APIRoute = ({ url }) => {
  const params = new URLSearchParams(url.search);

  // shop.astro accepts either name; normalising to `search` means a link
  // carrying both cannot arrive with two different terms. The same
  // normalisation the shop itself applies — trimmed, control characters and
  // angle brackets stripped, whitespace collapsed, length bounded — so the two
  // routes cannot disagree about what a query even is.
  const term = normalizeSearchParam(params.get('search') ?? params.get('q'));
  params.delete('q');
  params.delete('search');
  if (term) params.set('search', term);

  const query = params.toString();
  return new Response(null, {
    status: 301,
    headers: {
      Location: query ? `/shop?${query}` : '/shop',
      // Varies only by query string, so a short shared cache is safe.
      'Cache-Control': 'public, max-age=300',
    },
  });
};
