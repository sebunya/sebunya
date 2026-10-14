/**
 * JSON-LD serialization for inline <script type="application/ld+json"> tags.
 * Mirrors serializeJsonLd in apps/api/src/domain/seo/StructuredData.ts:
 * angle brackets and ampersands are escaped so user-influenced strings can
 * never break out of the script tag.
 */
export function serializeJsonLd(node: unknown): string {
  return JSON.stringify(node)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

export function breadcrumbJsonLd(items: Array<{ name: string; url: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
  };
}

/**
 * schema.org availability for a product's availability kind, or null when stock is not known (the field is then
 * left out: CLAUDE.md, no invented stock claims). One map for the product page and every listing: the shop and hub
 * listings said OutOfStock for anything not in_stock, a pre-order or an unverified product included, while the
 * product page said PreOrder or nothing (and Merchant Center saw the contradiction).
 */
export function schemaAvailability(kind: string | null | undefined): string | null {
  switch (kind) {
    case 'in_stock': return 'https://schema.org/InStock';
    case 'out_of_stock': return 'https://schema.org/OutOfStock';
    case 'pre_order': return 'https://schema.org/PreOrder';
    default: return null;
  }
}
