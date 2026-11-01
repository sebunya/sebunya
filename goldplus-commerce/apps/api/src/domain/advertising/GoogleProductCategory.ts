/**
 * Google product taxonomy for the Merchant feed.
 *
 * `g:google_product_category` is what puts a product in the right Shopping
 * results and comparison sets; a missing or wrong value is the most common
 * reason a compliant feed still ranks nowhere. Google accepts the full path
 * string, which is what we emit. The mapping is by what the product IS —
 * read from its name and our own category — and returns null when it cannot
 * be sure, because Google auto-classifies an item with no category far better
 * than it recovers from a wrong one. Every path here is an existing node of
 * the taxonomy (https://support.google.com/merchants/answer/6324436).
 */
export const GOOGLE_CATEGORY = {
  batteries: 'Electronics > Electronics Accessories > Power > Batteries',
  chargers: 'Electronics > Electronics Accessories > Power > Power Adapters & Chargers',
  cables: 'Electronics > Electronics Accessories > Cables',
  headphones: 'Electronics > Audio > Audio Components > Headphones & Headsets > Headphones',
  speakers: 'Electronics > Audio > Audio Components > Speakers',
  memoryCards: 'Electronics > Electronics Accessories > Memory > Flash Memory > Flash Memory Cards',
  flashDrives: 'Electronics > Electronics Accessories > Memory > Flash Memory > USB Flash Drives',
  mice: 'Electronics > Electronics Accessories > Computer Components > Input Devices > Mice & Trackballs',
  soundCards: 'Electronics > Electronics Accessories > Computer Components > I/O Cards & Adapters > Audio Cards & Adapters',
  memoryAccessories: 'Electronics > Electronics Accessories > Memory Accessories',
} as const;

/** Ordered: the first rule whose words appear in the name wins, so "car charger" and "charger" both land on chargers, "power bank" before "battery". */
const RULES: Array<[RegExp, string]> = [
  [/\bpower ?bank\b|\bpower station\b/i, GOOGLE_CATEGORY.chargers],
  [/\bcharger\b|\bcharging kit\b|\badapter\b/i, GOOGLE_CATEGORY.chargers],
  [/\bbattery\b|\bbatteries\b/i, GOOGLE_CATEGORY.batteries],
  [/\bcable\b|\bcord\b/i, GOOGLE_CATEGORY.cables],
  [/\bspeaker\b|\bsound ?bar\b/i, GOOGLE_CATEGORY.speakers],
  [/\bearphone|\bearbud|\bheadphone|\bheadset|\bbluetooth\b|\btws\b/i, GOOGLE_CATEGORY.headphones],
  [/\bmemory card\b|\bsd card\b|\bmicro ?sd\b/i, GOOGLE_CATEGORY.memoryCards],
  [/\bflash drive\b|\busb drive\b|\bpen ?drive\b|\bflash disk\b/i, GOOGLE_CATEGORY.flashDrives],
  [/\bmouse\b|\bmice\b/i, GOOGLE_CATEGORY.mice],
  [/\bsound card\b|\baudio card\b/i, GOOGLE_CATEGORY.soundCards],
  [/\bcard reader\b/i, GOOGLE_CATEGORY.memoryAccessories],
];

export function googleProductCategoryFor(product: { name: string; categoryName?: string | null; subcategory?: string | null }): string | null {
  const text = `${product.name} ${product.subcategory ?? ''}`;
  for (const [re, path] of RULES) if (re.test(text)) return path;
  // Our own category is the last word only when it is unambiguous on its own.
  const cat = (product.categoryName ?? '').toLowerCase();
  if (cat.includes('storage')) return null; // cards and drives differ; the name decides
  if (cat.includes('sound')) return GOOGLE_CATEGORY.headphones;
  return null;
}

/** `g:product_type` is OUR taxonomy path — free text Google uses for grouping and bidding. */
export function productTypeFor(product: { categoryName?: string | null; subcategory?: string | null }): string | null {
  const parts = [product.categoryName, product.subcategory].map((s) => (s ?? '').trim()).filter((s) => s.length > 0);
  return parts.length > 0 ? parts.join(' > ') : null;
}
