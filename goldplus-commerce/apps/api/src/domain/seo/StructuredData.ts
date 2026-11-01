import { AggregateRatingJsonLd } from '../reviews/ReviewDomain';

/**
 * U6 — JSON-LD structured data builders (AC3/AC4). Pure domain. Shapes match
 * schema.org / Google's requirements; the external Rich Results Test is run by an
 * operator (its result is not fabricated here). User-supplied strings are escaped
 * at serialization so JSON-LD cannot break out of its <script> tag.
 */

export interface OrgProfile { name: string; url: string; logoUrl?: string; sameAs: string[]; }

export function organizationJsonLd(org: OrgProfile) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: org.name,
    url: org.url,
    ...(org.logoUrl ? { logo: org.logoUrl } : {}),
    sameAs: org.sameAs,
  };
}

export function websiteSearchActionJsonLd(input: { name: string; url: string; searchUrlTemplate: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: input.name,
    url: input.url,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: input.searchUrlTemplate },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; url: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
  };
}

export function itemListJsonLd(items: Array<{ name: string; url: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, url: it.url })),
  };
}

export function faqPageJsonLd(qas: Array<{ question: string; answer: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: qas.map((qa) => ({
      '@type': 'Question',
      name: qa.question,
      acceptedAnswer: { '@type': 'Answer', text: qa.answer },
    })),
  };
}

export interface ProductJsonLdInput {
  name: string;
  description: string;
  sku: string;
  brand: string;
  url: string;
  imageUrls: string[];
  priceUgx: number;
  priceValidUntil: string; // YYYY-MM-DD
  inStock: boolean;
  gtin?: string | null;
  itemCondition?: 'new' | 'used' | 'refurbished';
  sellerName: string;
  returnDays?: number | null;
  aggregateRating?: AggregateRatingJsonLd | null;
}

const CONDITION_URL: Record<string, string> = {
  new: 'https://schema.org/NewCondition',
  used: 'https://schema.org/UsedCondition',
  refurbished: 'https://schema.org/RefurbishedCondition',
};

export function productJsonLd(input: ProductJsonLdInput) {
  const offer: Record<string, unknown> = {
    '@type': 'Offer',
    url: input.url,
    priceCurrency: 'UGX',
    price: input.priceUgx,
    priceValidUntil: input.priceValidUntil,
    itemCondition: CONDITION_URL[input.itemCondition ?? 'new'],
    availability: input.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    seller: { '@type': 'Organization', name: input.sellerName },
    shippingDetails: {
      '@type': 'OfferShippingDetails',
      shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'UG' },
    },
    hasMerchantReturnPolicy: {
      '@type': 'MerchantReturnPolicy',
      applicableCountry: 'UG',
      returnPolicyCategory: input.returnDays && input.returnDays > 0 ? 'https://schema.org/MerchantReturnFiniteReturnWindow' : 'https://schema.org/MerchantReturnNotPermitted',
      ...(input.returnDays && input.returnDays > 0 ? { merchantReturnDays: input.returnDays, returnMethod: 'https://schema.org/ReturnInStore' } : {}),
    },
  };
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: input.name,
    description: input.description,
    sku: input.sku,
    brand: { '@type': 'Brand', name: input.brand },
    image: input.imageUrls,
    ...(input.gtin ? { gtin: input.gtin } : {}),
    ...(input.aggregateRating ? { aggregateRating: input.aggregateRating } : {}),
    offers: offer,
  };
}

/** Serialize for embedding in a <script type="application/ld+json"> — escapes the
 * characters that could break out of the script element. */
export function serializeJsonLd(node: unknown): string {
  return JSON.stringify(node)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
