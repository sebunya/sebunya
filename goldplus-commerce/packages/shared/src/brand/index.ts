/**
 * The distinctive brand assets in words (Byron Sharp, How Brands Grow: one brand line, one name, used the same way on
 * every surface so memory links the category to GoldPlus). Every customer surface reads these; none types its own.
 */
export const BRAND_NAME = 'GoldPlus';

/** The one brand line. Category words first (what we sell), then who we are. Owner-approved framing 2026-11-04. */
export const BRAND_LINE = 'GoldPlus: our own line of phone and computer accessories, made for Africa.';

/** The category words a first-time visitor must read in the first screen (the category entry points we sell into). */
export const BRAND_CATEGORIES = 'Chargers, power banks, phone batteries, cables, earbuds and storage';

/** The default page description: the brand line, then the categories. */
export const BRAND_DESCRIPTION = `${BRAND_LINE} ${BRAND_CATEGORIES}, delivered in Kampala and shipped upcountry.`;

const BRAND_PREFIX = /^\s*gold\s*plus\s+/i;

/** "GoldPlus GP-C03 Charger" → "GP-C03 Charger", for sentences that already say "at GoldPlus". */
export function stripBrandPrefix(name: string): string {
  return name.replace(BRAND_PREFIX, '').trim();
}

/** A page title that names the brand exactly once: "GoldPlus GP-C03 | …" stays; "Flash drive 32GB" gains " | GoldPlus". */
export function brandTitle(title: string): string {
  return /gold\s*plus/i.test(title) ? title : `${title} | ${BRAND_NAME}`;
}

/** Accessory brands people search for that we do not stock: the query is a category entry point, answered with our own line. */
export const COMPETITOR_ACCESSORY_BRANDS: readonly string[] = ['oraimo', 'anker', 'baseus', 'ugreen', 'romoss', 'aukey', 'hoco', 'remax', 'awei', 'joyroom', 'borofone', 'ldnio', 'xo'];

/**
 * Brand intent in a search: "goldplus charger" and "oraimo charger" both mean "a charger". Returns the words to match the
 * catalogue with (brand words removed) and, when a competitor was named, which one, so the page can say so honestly.
 */
export function readBrandIntent(search: string): { matchSearch: string; ownBrand: boolean; competitor: string | null } {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  let ownBrand = false;
  let competitor: string | null = null;
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === 'goldplus' || (w === 'gold' && words[i + 1] === 'plus')) { ownBrand = true; if (w === 'gold') i += 1; continue; }
    if (COMPETITOR_ACCESSORY_BRANDS.includes(w)) { competitor = competitor ?? w; continue; }
    kept.push(w);
  }
  return { matchSearch: kept.join(' '), ownBrand, competitor };
}
