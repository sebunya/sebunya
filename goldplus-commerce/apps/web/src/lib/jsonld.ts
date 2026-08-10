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
