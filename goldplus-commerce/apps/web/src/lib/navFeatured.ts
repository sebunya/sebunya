import { apiBase } from './api';

/**
 * The header's featured cross-sell cards ("Most carried"), served by REAL data
 * instead of a hardcoded name over a stock photo. Cached in-process (the header
 * renders on every page; this must never add a fetch per view).
 *
 * Honesty rule: the label "Most carried" is a popularity claim, so it is used
 * only when the recommendation engine emits its evidence-gated POPULAR_NOW
 * reason. Otherwise the card says "Carried in the shop" — a plain stock fact.
 */
export interface NavFeaturedCard {
  label: string;
  name: string;
  slug: string;
  imageUrl: string;
  blurb: string;
  priceUgx: number | null;
}

const TTL_MS = 120_000;
let cached: NavFeaturedCard[] | null = null;
let cachedAt = 0;
let inflight: Promise<NavFeaturedCard[]> | null = null;

async function fetchCards(): Promise<NavFeaturedCard[]> {
  try {
    // Evidence first: the engine's home_trending list, identity-free.
    let popular: Array<{ productId: string; slug: string; name: string; imageUrl?: string; reasonCodes?: string[] }> = [];
    try {
      const res = await fetch(`${apiBase}/recommendations?placement=home_trending&limit=6`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(2000),
      });
      const json: any = res.ok ? await res.json().catch(() => null) : null;
      if (json?.success && Array.isArray(json.data?.items)) popular = json.data.items;
    } catch { /* evidence is optional */ }

    const res = await fetch(`${apiBase}/products?limit=50`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(2500) });
    const json: any = res.ok ? await res.json().catch(() => null) : null;
    const products: any[] = json?.success && Array.isArray(json.data) ? json.data : [];
    const imaged = products.filter((p) => p.primaryImageUrl && p.availability?.kind === 'in_stock');
    if (imaged.length === 0) return [];

    const bySlug = new Map(imaged.map((p) => [p.slug, p]));
    const cards: NavFeaturedCard[] = [];

    // Card 1: evidence-based when possible.
    const proven = popular.find((item) => (item.reasonCodes ?? []).includes('POPULAR_NOW') && bySlug.has(item.slug));
    const first = proven ? bySlug.get(proven.slug) : imaged.slice().sort((a, b) => (b.availability?.quantity ?? 0) - (a.availability?.quantity ?? 0))[0];
    const toCard = (p: any, label: string): NavFeaturedCard => ({
      label,
      name: p.name,
      slug: p.slug,
      imageUrl: p.primaryImageUrl,
      blurb: p.categoryName ? `From our ${String(p.categoryName).toLowerCase()} shelf` : 'On the shelf now',
      priceUgx: typeof p.retailPriceUgx === 'number' && p.retailPriceUgx > 0 ? p.retailPriceUgx : null,
    });

    cards.push(toCard(first, proven ? 'Most carried' : 'Carried in the shop'));
    for (const p of imaged.filter((x) => x.slug !== first.slug)
      .sort((a, b) => (b.availability?.quantity ?? 0) - (a.availability?.quantity ?? 0))
      .slice(0, 5)) {
      cards.push(toCard(p, 'Also worth carrying'));
    }
    return cards;
  } catch {
    return cached ?? [];
  }
}

export async function getNavFeatured(): Promise<NavFeaturedCard[]> {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;
  if (inflight) return inflight;
  inflight = fetchCards()
    .then((v) => { cached = v; cachedAt = Date.now(); inflight = null; return v; })
    .catch(() => { inflight = null; return cached ?? []; });
  return inflight;
}
