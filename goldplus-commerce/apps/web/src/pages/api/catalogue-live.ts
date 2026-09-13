import type { APIRoute } from 'astro';
import { apiBase } from '../../lib/api';
import { fetchApprovedCatalogue } from '../../lib/catalogue';

/**
 * Live price, product floor, availability and image for every approved product,
 * keyed by product id — what the recently-viewed rail overlays onto a visitor's
 * local history so a bookmark never shows last week's price (2026-09-13).
 *
 * It used to be stamped into every page as data-live-products (34 KB of HTML,
 * ~5 KB compressed) although the rail renders only for returning visitors with
 * history, or on the product page. That pushed the home document past a
 * slow-4G round-trip boundary; the rail now asks for it only when it renders.
 * An upstream failure is success:false and never cached, exactly as the stamped
 * version treated an empty catalogue.
 */
type Live = { price?: number; floor: number | null; availability?: unknown; imageUrl?: string };

export const GET: APIRoute = async () => {
  const catalogue = await fetchApprovedCatalogue(apiBase);
  if (catalogue.length === 0) {
    return new Response(JSON.stringify({ success: false, data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  const data: Record<string, Live> = {};
  for (const p of catalogue) {
    if (typeof p.id !== 'string') continue;
    data[p.id] = {
      price: typeof p.retailPriceUgx === 'number' && p.retailPriceUgx > 0 ? p.retailPriceUgx : undefined,
      // The product's own floor (Price A). Absent = not discountable.
      floor: typeof p.floorPriceUgx === 'number' && p.floorPriceUgx > 0 ? p.floorPriceUgx : null,
      availability: p.availability,
      imageUrl: p.primaryImageUrl ?? undefined,
    };
  }
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    // Short: prices and stock must not go stale for long. Private to the browser;
    // the edge does not cache it.
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=60' },
  });
};
