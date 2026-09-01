import type { ProductPublicDto } from '@goldplus/shared';
import { apiBase } from './api';
import { fetchApprovedCatalogue } from './catalogue';
import { getBusinessInfo } from './businessInfo';
import { getTaxonomy } from './taxonomy';
import { SITE_ORIGIN } from './sitemap';
import { RETURNS_POLICY, merchantReturnPolicyJsonLd } from './returnsPolicy';
import { renderAgentMarkdown, ugx, type AgentDocument } from './agentMarkdown';
import {
  DISCOVERY_TAXONOMY, filterDiscoveryProducts, sortDiscoveryProducts,
  normalizeSearchParam, normalizeCategoryParam, normalizeSubcategoryParam, normalizeSortParam,
  categoryNameForSlug, subcategoryNameForSlug,
} from './product-discovery';
import { CATEGORY_HUBS, productsForHub, productsForHubChild, hubPath } from './categoryHubs';

/**
 * The Markdown an agent receives, generated from the same data the HTML page
 * renders — never scraped back out of the HTML. An assistant quoting us gets
 * the price the shop charges, live stock, the maker's verified specifications
 * and the returns promise, with the page's JSON-LD attached so it can be
 * consumed as structured data without a second fetch.
 *
 * Cost matters: an agent request must be CHEAPER than the HTML page it
 * replaces, never more expensive. So the catalogue is fetched once and shared
 * by every list document for a short TTL, and no document renders HTML.
 */
const availabilityWord = (kind: string): string =>
  kind === 'in_stock' ? 'In stock' : kind === 'pre_order' ? 'Available to pre-order' : kind === 'out_of_stock' ? 'Out of stock' : 'Stock not confirmed';

const schemaAvailability = (kind: string): string =>
  kind === 'in_stock' ? 'https://schema.org/InStock' : kind === 'pre_order' ? 'https://schema.org/PreOrder' : 'https://schema.org/OutOfStock';

/** One catalogue read serves every list document for a minute. */
const CATALOGUE_TTL_MS = 60_000;
let catalogueCache: { at: number; products: ProductPublicDto[] } | null = null;
let catalogueInflight: Promise<ProductPublicDto[]> | null = null;
async function catalogue(): Promise<ProductPublicDto[]> {
  const now = Date.now();
  if (catalogueCache && now - catalogueCache.at < CATALOGUE_TTL_MS) return catalogueCache.products;
  if (catalogueInflight) return catalogueInflight;
  catalogueInflight = fetchApprovedCatalogue(apiBase)
    .then((products) => { catalogueCache = { at: Date.now(), products }; catalogueInflight = null; return products; })
    .catch(() => { catalogueInflight = null; return catalogueCache?.products ?? []; });
  return catalogueInflight;
}

const productUrl = (p: ProductPublicDto): string => `${SITE_ORIGIN}/products/${p.slug}`;
const absolute = (url: string): string => (/^https?:\/\//i.test(url) ? url : `${SITE_ORIGIN}${url}`);

/** The delivery and returns footer every document carries, so a quote is never missing the terms. */
function termsBlock(): string[] {
  return [
    '## Buying from GoldPlus',
    '',
    '- **Delivery:** same-day in Kampala and Wakiso; the fee is calculated for the address and shown before payment.',
    '- **Payment:** MTN or Airtel Mobile Money, Visa or Mastercard, or pay on delivery or at the shop.',
    `- **Returns:** ${RETURNS_POLICY.windowDays} days for a change of mind (unused and complete; customer covers return carriage). A faulty product is replaced or refunded with GoldPlus covering the carriage. ${RETURNS_POLICY.policyUrl}`,
    '',
  ];
}

/** The Product node the HTML page publishes, so the Markdown carries the same structured data. */
function productJsonLd(p: ProductPublicDto): Record<string, unknown> {
  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    url: productUrl(p),
    brand: { '@type': 'Brand', name: 'GoldPlus' },
    category: p.categoryName,
  };
  if (p.sku) node.sku = p.sku;
  if (p.modelNumber) node.mpn = p.modelNumber;
  if (p.primaryImageUrl) node.image = absolute(p.primaryImageUrl);
  const description = (p.longDescription ?? '').trim() || (p.shortDescription ?? '').trim();
  if (description) node.description = description;
  const specs = Object.entries(p.verifiedSpecs ?? {});
  if (specs.length > 0) {
    node.additionalProperty = specs.map(([name, value]) => ({ '@type': 'PropertyValue', name, value: String(value) }));
  }
  if (p.retailPriceUgx != null) {
    node.offers = {
      '@type': 'Offer',
      priceCurrency: 'UGX',
      price: p.retailPriceUgx,
      url: productUrl(p),
      itemCondition: 'https://schema.org/NewCondition',
      availability: schemaAvailability(p.availability?.kind ?? 'unknown'),
      hasMerchantReturnPolicy: merchantReturnPolicyJsonLd(),
    };
  }
  return node;
}

function productDocument(p: ProductPublicDto): AgentDocument {
  const lines: string[] = [`# ${p.name}`, ''];
  const facts: string[] = [];
  if (p.retailPriceUgx != null) facts.push(`- **Price:** ${ugx(p.retailPriceUgx)}`);
  facts.push(`- **Availability:** ${availabilityWord(p.availability?.kind ?? 'unknown')}`);
  if (p.categoryName) facts.push(`- **Category:** ${p.categoryName}`);
  if (p.sku) facts.push(`- **SKU:** ${p.sku}`);
  if (p.modelNumber) facts.push(`- **Model:** ${p.modelNumber}`);
  facts.push('- **Brand:** GoldPlus', '- **Condition:** New');
  lines.push(...facts, '');

  const body = (p.longDescription ?? '').trim() || (p.shortDescription ?? '').trim();
  if (body) lines.push(body, '');

  const specs = Object.entries(p.verifiedSpecs ?? {});
  if (specs.length > 0) {
    lines.push('## Specifications', '', '| Specification | Value |', '| --- | --- |');
    for (const [k, v] of specs) lines.push(`| ${k} | ${String(v)} |`);
    lines.push('', "_Taken from the manufacturer's own specification for this model._", '');
  }
  if (p.images && p.images.length > 0) {
    lines.push('## Images', '', ...p.images.slice(0, 10).map((img) => `- ${absolute(img.url)}`), '');
  }
  lines.push(...termsBlock(), `Product page: ${productUrl(p)}`, '');

  return {
    title: p.name,
    description: (p.shortDescription ?? '').trim() || null,
    body: lines.join('\n'),
    jsonLd: [productJsonLd(p)],
  };
}

/** A product table — the densest honest form for a list of things to buy. */
function productTable(products: ProductPublicDto[]): string[] {
  return [
    '| Product | Price | Availability | Page |',
    '| --- | --- | --- | --- |',
    ...products.map((p) => `| ${p.name} | ${p.retailPriceUgx != null ? ugx(p.retailPriceUgx) : '—'} | ${availabilityWord(p.availability?.kind ?? 'unknown')} | ${productUrl(p)} |`),
  ];
}

function listJsonLd(products: ProductPublicDto[], name: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: products.length,
    itemListElement: products.slice(0, 60).map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Product',
        name: p.name,
        url: productUrl(p),
        ...(p.retailPriceUgx != null
          ? { offers: { '@type': 'Offer', priceCurrency: 'UGX', price: p.retailPriceUgx, availability: schemaAvailability(p.availability?.kind ?? 'unknown') } }
          : {}),
      },
    })),
  };
}

function groupedCatalogue(products: ProductPublicDto[], title: string, intro: string): AgentDocument {
  const byCategory = new Map<string, ProductPublicDto[]>();
  for (const p of products) {
    const key = p.categoryName || 'Other';
    byCategory.set(key, [...(byCategory.get(key) ?? []), p]);
  }
  const lines: string[] = [`# ${title}`, '', intro, ''];
  for (const [category, items] of [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## ${category} (${items.length})`, '', ...productTable(items), '');
  }
  lines.push(...termsBlock());
  return { title, description: intro, body: lines.join('\n'), jsonLd: [listJsonLd(products, title)] };
}

/** /shop, honouring the same filters the HTML page reads. */
async function shopDocument(url: URL): Promise<AgentDocument | null> {
  const [all, taxonomy] = await Promise.all([catalogue(), getTaxonomy().catch(() => DISCOVERY_TAXONOMY)]);
  if (all.length === 0) return null;
  const search = normalizeSearchParam(url.searchParams.get('search') ?? url.searchParams.get('q'));
  const category = normalizeCategoryParam(url.searchParams.get('category'), taxonomy);
  const subcategory = normalizeSubcategoryParam(url.searchParams.get('subcategory'), category, taxonomy);
  const sort = normalizeSortParam(url.searchParams.get('sort'));
  const filtered = sortDiscoveryProducts(filterDiscoveryProducts(all, { search, category, subcategory }, taxonomy), sort, taxonomy);

  const named = [categoryNameForSlug(category, taxonomy), subcategoryNameForSlug(subcategory, taxonomy)].filter(Boolean).join(' › ');
  const title = search
    ? `GoldPlus search: ${search}`
    : named ? `GoldPlus ${named}` : 'GoldPlus catalogue';
  const intro = search
    ? `${filtered.length} product${filtered.length === 1 ? '' : 's'} matching “${search}” at GoldPlus, Kampala. Prices in Ugandan shillings, stock is live.`
    : `${filtered.length} product${filtered.length === 1 ? '' : 's'}${named ? ` in ${named}` : ' GoldPlus currently sells online'}. Prices in Ugandan shillings, stock is live.`;

  if (filtered.length === 0) {
    return { title, description: intro, body: [`# ${title}`, '', intro, '', 'Nothing matches this filter today.', '', ...termsBlock()].join('\n') };
  }
  // A filtered view is one list; the unfiltered catalogue reads better grouped.
  if (search || named) {
    return { title, description: intro, body: [`# ${title}`, '', intro, '', ...productTable(filtered), '', ...termsBlock()].join('\n'), jsonLd: [listJsonLd(filtered, title)] };
  }
  return groupedCatalogue(filtered, 'GoldPlus catalogue', intro);
}

/** Category hub pages (/power, /power/chargers …) — the same products the page lists. */
async function hubDocument(pathname: string): Promise<AgentDocument | null> {
  const segments = pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (segments.length === 0 || segments.length > 2) return null;
  const hub = CATEGORY_HUBS.find((h) => h.slug === segments[0]);
  if (!hub) return null;
  const child = segments[1] ? hub.children?.find((c) => c.slug === segments[1]) : undefined;
  if (segments[1] && !child) return null;

  const [all, taxonomy] = await Promise.all([catalogue(), getTaxonomy().catch(() => DISCOVERY_TAXONOMY)]);
  const products = child ? productsForHubChild(hub, child, all, taxonomy) : productsForHub(hub, all, taxonomy);
  const title = child ? child.h1 : hub.h1;
  const intro = (child ? [child.intro] : hub.intro).join(' ');
  const lines = [`# ${title}`, '', intro, ''];
  if (products.length > 0) lines.push(`${products.length} product${products.length === 1 ? '' : 's'}.`, '', ...productTable(products), '');
  lines.push(...termsBlock(), `Page: ${SITE_ORIGIN}${hubPath(hub.slug, child?.slug)}`, '');
  return { title, description: intro, body: lines.join('\n'), jsonLd: products.length > 0 ? [listJsonLd(products, title)] : [] };
}

async function faqDocument(): Promise<AgentDocument> {
  const biz = await getBusinessInfo();
  const cutoff = `${biz.sameDayCutoffHour % 12 || 12}${biz.sameDayCutoffHour >= 12 ? 'pm' : 'am'}`;
  const qa: Array<[string, string]> = [
    ['Do you deliver, and how long does it take?',
      `${biz.deliveryNote} Delivery runs ${biz.deliveryHours}, ${biz.openDays}. Order before ${cutoff} for the same day's run. The fee is calculated for the address and shown before payment.`],
    ['Where is the GoldPlus shop and when is it open?',
      `${biz.addressLine1.replace(/\.$/, '')} — ${biz.addressLine2.replace(/\.$/, '')}. Open ${biz.openDays}, ${biz.shopHours}. Phone and WhatsApp ${biz.phoneDisplay}. Online orders can be collected at the shop.`],
    ['How do I know which replacement battery fits my phone?',
      `Search the phone in the battery finder (${SITE_ORIGIN}/battery-finder), match the code printed on the battery inside the phone to the code in the product name, or send the phone model on WhatsApp. GoldPlus confirms the fit before payment.`],
    ['How can I pay?',
      'MTN or Airtel Mobile Money, or a Visa or Mastercard through PesaPal; or pay on delivery or at the shop.'],
    ['Are GoldPlus products genuine, and what if something is faulty?',
      `Products are GoldPlus-branded and every unit is tested before it is sold. A faulty product is replaced or refunded with GoldPlus covering the return carriage. A change-of-mind return is accepted within ${RETURNS_POLICY.windowDays} days of delivery or collection, unused and complete, with the customer covering the return carriage. ${RETURNS_POLICY.policyUrl}`],
  ];
  const body = ['# GoldPlus: questions and answers', '', ...qa.flatMap(([q, a]) => [`## ${q}`, '', a, ''])].join('\n');
  return {
    title: 'GoldPlus: questions and answers',
    description: 'Delivery, shop address and hours, battery fitment, payment methods and what happens if a product is faulty.',
    body,
    jsonLd: [{
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: qa.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    }],
  };
}

async function homeDocument(): Promise<AgentDocument> {
  const [biz, products] = await Promise.all([getBusinessInfo(), catalogue()]);
  const byCategory = new Map<string, number>();
  for (const p of products) byCategory.set(p.categoryName || 'Other', (byCategory.get(p.categoryName || 'Other') ?? 0) + 1);
  const prices = products.map((p) => p.retailPriceUgx).filter((v): v is number => typeof v === 'number' && v > 0);
  const body = [
    '# GoldPlus — phone accessories and replacement batteries in Kampala',
    '',
    `GoldPlus sells and delivers phone accessories and replacement phone batteries in Kampala, Uganda. ${products.length} products are listed online${prices.length ? `, from ${ugx(Math.min(...prices))} to ${ugx(Math.max(...prices))}` : ''}. GoldPlus is both the shop and the brand; every unit is tested before it is sold.`,
    '',
    '## The shop',
    '',
    `- **Address:** ${biz.addressLine1.replace(/\.$/, '')} — ${biz.addressLine2.replace(/\.$/, '')}`,
    `- **Open:** ${biz.openDays}, ${biz.shopHours}`,
    `- **Phone and WhatsApp:** ${biz.phoneDisplay}`,
    '',
    '## What GoldPlus sells',
    '',
    ...[...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => `- ${name}: ${count} products`),
    '',
    '## Where to look',
    '',
    `- Every product: ${SITE_ORIGIN}/shop`,
    `- Battery that fits a phone: ${SITE_ORIGIN}/battery-finder`,
    `- Questions and answers: ${SITE_ORIGIN}/faq`,
    `- Machine-readable brief: ${SITE_ORIGIN}/llms.txt`,
    '',
    ...termsBlock(),
  ].join('\n');
  return { title: 'GoldPlus — phone accessories and replacement batteries in Kampala', description: 'What GoldPlus sells, where the shop is, and how delivery, payment and returns work.', body };
}

/** Paths this module can represent. Anything else falls through to the HTML page. */
export async function agentDocumentFor(url: URL): Promise<string | null> {
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  if (pathname === '/') return renderAgentMarkdown(await homeDocument());
  if (pathname === '/faq') return renderAgentMarkdown(await faqDocument());
  if (pathname === '/shop') {
    const doc = await shopDocument(url);
    return doc ? renderAgentMarkdown(doc) : null;
  }

  const productMatch = pathname.match(/^\/products\/([^/]+)$/);
  if (productMatch) {
    const res = await fetch(`${apiBase}/products/${encodeURIComponent(productMatch[1])}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const json: any = await res.json().catch(() => null);
    const product: ProductPublicDto | null = json?.success ? json.data : null;
    return product ? renderAgentMarkdown(productDocument(product)) : null;
  }

  const hub = await hubDocument(pathname);
  return hub ? renderAgentMarkdown(hub) : null;
}

/**
 * Can this path be served as Markdown? Used to advertise the alternate
 * representation on the HTML response — a promise we must be able to keep, so
 * it mirrors the routing in agentDocumentFor exactly.
 */
export function agentRepresentablePath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/faq' || path === '/shop') return true;
  if (/^\/products\/[^/]+$/.test(path)) return true;
  const segments = path.replace(/^\/+/, '').split('/');
  if (segments.length < 1 || segments.length > 2) return false;
  const hub = CATEGORY_HUBS.find((h) => h.slug === segments[0]);
  if (!hub) return false;
  return !segments[1] || Boolean(hub.children?.some((c) => c.slug === segments[1]));
}
