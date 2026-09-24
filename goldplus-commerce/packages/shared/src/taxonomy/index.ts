/**
 * Product discovery taxonomy — the categories and subcategories that drive the
 * homepage "Shop by category" tiles, the shop filters, and the keyword-based
 * subcategory inference. One admin-editable document (taxonomy_config JSONB
 * singleton); DEFAULT_TAXONOMY is the seed + SSR fallback.
 *
 * Discovery is keyed by category NAME (products carry categoryName) and by
 * keyword inference — it does NOT touch the products↔categories FK, so editing
 * this document is safe for the catalog. `keywords` are lowercase; inference
 * picks the LONGEST matching keyword so "car charger" beats "charger".
 */
export interface TaxonomySubcategory {
  slug: string;
  name: string;
  /** Lowercase inference keywords; longest match wins in getProductSubcategory. */
  keywords: string[];
}

export interface TaxonomyCategory {
  slug: string;
  name: string;
  /** Optional operator description (shop header / SEO). */
  description?: string;
  /** Show as a homepage "Shop by category" tile. */
  showOnHomepage: boolean;
  /** Short blurb under the homepage tile. */
  homepageBlurb?: string;
  /**
   * Optional photo for the homepage tile (uploaded via the media library or an
   * absolute URL). When absent the tile renders the category's icon — keyed by
   * slug in code — never a bare frame.
   */
  imageUrl?: string;
  /** Legacy/alias slugs that normalize to this category (e.g. "power"). */
  aliases?: string[];
  subcategories: TaxonomySubcategory[];
}

export type Taxonomy = TaxonomyCategory[];

export const DEFAULT_TAXONOMY: Taxonomy = [
  {
    slug: 'power-devices',
    name: 'Power Devices',
    showOnHomepage: true,
    homepageBlurb: 'Banks, batteries, chargers',
    aliases: ['power'],
    subcategories: [
      { slug: 'chargers', name: 'Chargers', keywords: ['charger', 'adapter', 'charging brick'] },
      { slug: 'power-banks', name: 'Power Banks', keywords: ['power bank'] },
      // 2026-08-26: replacement batteries are their own shelf. A router or MiFi
      // battery is NOT a phone battery, so the two never share a subcategory:
      // the finder, the compatibility rules and the navigation all depend on
      // that separation. The battery module sets these on every battery it
      // creates (BATTERY_CATEGORY_LABELS).
      { slug: 'phone-batteries', name: 'Phone Batteries', keywords: ['phone battery', 'replacement battery', 'battery'] },
      { slug: 'mifi-router-batteries', name: 'MiFi & Router Batteries', keywords: ['mifi battery', 'router battery'] },
    ],
  },
  {
    slug: 'sound-devices',
    name: 'Sound Devices',
    showOnHomepage: true,
    homepageBlurb: 'Earbuds, headphones',
    aliases: ['sound'],
    subcategories: [
      { slug: 'earbuds', name: 'Earbuds', keywords: ['earbud', 'earphone', 'headphone'] },
      { slug: 'speakers', name: 'Speakers', keywords: ['speaker'] },
    ],
  },
  {
    slug: 'storage-devices',
    name: 'Storage Devices',
    showOnHomepage: true,
    homepageBlurb: '1GB to 512GB',
    aliases: ['storage'],
    subcategories: [
      { slug: 'flash-drives', name: 'Flash Drives', keywords: ['flash drive', 'usb drive'] },
      { slug: 'memory-cards', name: 'Memory Cards', keywords: ['memory card', 'micro sd', 'sd card'] },
    ],
  },
  {
    slug: 'car-accessories',
    name: 'Car Accessories',
    showOnHomepage: true,
    homepageBlurb: 'Chargers, Bluetooth kits',
    aliases: ['car'],
    subcategories: [
      { slug: 'mounts', name: 'Mounts', keywords: ['mount'] },
      { slug: 'car-chargers', name: 'Car Chargers', keywords: ['car charger'] },
    ],
  },
  {
    slug: 'pc-accessories',
    name: 'PC Accessories',
    // Tile brief: five categories, not four — PC belongs on the homepage.
    showOnHomepage: true,
    homepageBlurb: 'Mouse, sound cards',
    aliases: ['pc'],
    subcategories: [
      // No inference keywords by default (parity with the original code, which had
      // no PC inference); an operator can add keywords via the taxonomy editor.
      { slug: 'mice', name: 'Mice', keywords: [] },
      { slug: 'sound-cards', name: 'Sound Cards', keywords: [] },
    ],
  },
];

/** A keyword matched as a word-boundary phrase (spaces match any whitespace). */
function taxonomyKeywordMatches(keyword: string, haystack: string): boolean {
  const escaped = keyword.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  if (!escaped) return false;
  return new RegExp('\\b' + escaped).test(haystack);
}

/**
 * The subcategory a product browses under, inferred from its name and category
 * by keyword — the longest matching keyword wins, so "car charger" beats
 * "charger". The ONE inference both the /shop page and the header dropdown use,
 * so a subcategory word ("memory cards") finds the same products in both.
 */
export function inferSubcategory(
  product: { name: string; categoryName?: string | null },
  taxonomy: Taxonomy = DEFAULT_TAXONOMY,
): TaxonomySubcategory | null {
  const searchable = `${product.name} ${product.categoryName ?? ''}`.toLowerCase();
  let best: TaxonomySubcategory | null = null;
  let bestLen = 0;
  for (const category of taxonomy) {
    for (const sub of category.subcategories) {
      for (const keyword of sub.keywords ?? []) {
        if (keyword.length > bestLen && taxonomyKeywordMatches(keyword, searchable)) {
          best = sub;
          bestLen = keyword.length;
        }
      }
    }
  }
  return best;
}
