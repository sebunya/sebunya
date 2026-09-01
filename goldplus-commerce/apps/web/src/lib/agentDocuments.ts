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
import { fetchPublishedPosts, fetchPost, formatArticleDate } from './blog';

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

  // The HTML page paginates at 24. An explicit ?page= must return that page and
  // nothing else, or the Markdown contradicts the URL it was asked for.
  const PAGE_SIZE = 24;
  const requestedPage = Number.parseInt(url.searchParams.get('page') ?? '', 10);
  if (Number.isFinite(requestedPage) && requestedPage > 0) {
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const page = Math.min(requestedPage, totalPages);
    const slice = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const pagedIntro = `Page ${page} of ${totalPages} — ${slice.length} of ${filtered.length} products. Prices in Ugandan shillings, stock is live.`;
    const nav: string[] = [];
    if (page > 1) nav.push(`Previous page: ${SITE_ORIGIN}/shop?page=${page - 1}`);
    if (page < totalPages) nav.push(`Next page: ${SITE_ORIGIN}/shop?page=${page + 1}`);
    nav.push(`Whole catalogue in one document: ${SITE_ORIGIN}/shop`);
    return {
      title: `${title} — page ${page}`,
      description: pagedIntro,
      body: [`# ${title}`, '', pagedIntro, '', ...productTable(slice), '', ...nav, '', ...termsBlock()].join('\n'),
      jsonLd: [listJsonLd(slice, title)],
    };
  }

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

async function blogIndexDocument(): Promise<AgentDocument | null> {
  const { posts, total } = await fetchPublishedPosts(50, 0);
  if (posts.length === 0) return null;
  const intro = `${total} guide${total === 1 ? '' : 's'} written by GoldPlus on choosing and using phone accessories in Uganda.`;
  const body = [
    '# GoldPlus guides and advice', '', intro, '',
    ...posts.flatMap((p) => [
      `## ${p.title}`, '',
      p.excerpt, '',
      `- Published: ${formatArticleDate(p.publishedAt)} · ${p.readingMinutes} min read`,
      `- Read: ${SITE_ORIGIN}/blog/${p.slug}`, '',
    ]),
  ].join('\n');
  return { title: 'GoldPlus guides and advice', description: intro, body };
}

async function blogPostDocument(slug: string): Promise<AgentDocument | null> {
  const post = await fetchPost(slug);
  if (!post) return null;
  const lines = [
    `# ${post.title}`, '',
    `_By ${post.authorName} · ${formatArticleDate(post.publishedAt)} · ${post.readingMinutes} min read_`, '',
    // The stored markup is markdown-flavoured already, so it travels intact.
    post.body.trim(), '',
  ];
  if (post.relatedProducts?.length) {
    lines.push('## Products mentioned', '', ...post.relatedProducts.map((p) => `- ${p.name}${p.retailPriceUgx != null ? ` — ${ugx(p.retailPriceUgx)}` : ''}: ${SITE_ORIGIN}/products/${p.slug}`), '');
  }
  lines.push(`Article: ${SITE_ORIGIN}/blog/${post.slug}`, '');
  return {
    title: post.seoTitle || post.title,
    description: post.seoDescription || post.excerpt,
    body: lines.join('\n'),
    jsonLd: [{
      '@context': 'https://schema.org', '@type': 'Article', headline: post.title,
      datePublished: post.publishedAt ?? undefined, dateModified: post.updatedAt,
      author: { '@type': 'Organization', name: 'GoldPlus' },
      publisher: { '@type': 'Organization', name: 'GoldPlus', url: SITE_ORIGIN },
      mainEntityOfPage: `${SITE_ORIGIN}/blog/${post.slug}`,
    }],
  };
}

/** Delivery, returns and warranty — the terms an assistant is asked to confirm. */
async function policyDocument(kind: 'returns' | 'warranty' | 'delivery'): Promise<AgentDocument> {
  const biz = await getBusinessInfo();
  const cutoff = `${biz.sameDayCutoffHour % 12 || 12}${biz.sameDayCutoffHour >= 12 ? 'pm' : 'am'}`;
  if (kind === 'delivery') {
    const body = [
      '# Delivery to Kampala and Wakiso', '',
      `${biz.deliveryNote} Delivery runs ${biz.deliveryHours}, ${biz.openDays}.`, '',
      `- Order before ${cutoff} for the same day's run; later orders go on the next one.`,
      '- The fee is calculated for the delivery address and shown before payment — never added afterwards.',
      `- Collection from the shop is free: ${biz.addressLine1.replace(/\.$/, '')}, open ${biz.openDays}, ${biz.shopHours}.`,
      `- Questions: ${biz.phoneDisplay} on phone or WhatsApp.`, '',
      `Page: ${SITE_ORIGIN}/delivery/kampala-wakiso`, '',
    ].join('\n');
    return { title: 'GoldPlus delivery to Kampala and Wakiso', description: biz.deliveryNote, body };
  }
  if (kind === 'returns') {
    const body = [
      '# GoldPlus returns policy', '',
      `## Changed your mind: ${RETURNS_POLICY.windowDays} days`, '',
      `You have ${RETURNS_POLICY.windowDays} days from delivery or collection to return an item you have changed your mind about. It must be unused and complete — the product, its packaging and everything in the box — with the receipt or order confirmation. For a change-of-mind return the customer covers the carriage back to GoldPlus. The refund goes back the way it was paid.`, '',
      '## If the product is faulty', '',
      'A faulty product is replaced or refunded, and GoldPlus pays the cost of getting it back. Contact support with the order number and a description of the fault; GoldPlus verifies the purchase and the coverage stated on the listing or receipt, then agrees the replacement or refund.', '',
      'Nothing in this policy removes protections under applicable Ugandan consumer law.', '',
      `Page: ${RETURNS_POLICY.policyUrl}`, '',
    ].join('\n');
    return { title: 'GoldPlus returns policy', description: `${RETURNS_POLICY.windowDays}-day change-of-mind returns; faulty products replaced or refunded with GoldPlus paying the carriage.`, body };
  }
  const body = [
    '# GoldPlus warranty', '',
    'Warranty coverage differs by product and brand. The coverage that applies is the one stated on the product listing, the receipt, or the manufacturer\'s documentation; this page does not add to or replace those terms.', '',
    'To claim, contact GoldPlus support with the order number or receipt, the product and a description of the fault. Support verifies the purchase, checks the applicable coverage, and explains the assessment, repair or replacement steps.', '',
    `Page: ${SITE_ORIGIN}/warranty`, '',
  ].join('\n');
  return { title: 'GoldPlus warranty', description: 'How warranty claims are handled; product-specific terms come from the listing and receipt.', body };
}

/** The battery finder — the question agents are asked most about this shop. */
async function batteryFinderDocument(): Promise<AgentDocument> {
  const products = await catalogue();
  const batteries = products.filter((p) => /batter/i.test(`${p.name} ${p.categoryName ?? ''}`));
  const named = batteries.filter((p) => /for |fits /i.test(p.name));
  const body = [
    '# Find the replacement battery that fits your phone', '',
    `GoldPlus stocks ${batteries.length} replacement phone batteries. The fit is confirmed before you pay, every time.`, '',
    '## Three ways to identify the right one', '',
    `1. Search the phone model in the finder: ${SITE_ORIGIN}/battery-finder`,
    '2. Open the phone and read the code printed on the battery inside, then match it to the code in the product name.',
    '3. Send the phone model on WhatsApp and GoldPlus confirms which pack fits.', '',
    ...(named.length > 0
      ? ['## Batteries listed by the phone they fit', '', ...productTable(named), '']
      : []),
    '## Batteries listed by pack code', '',
    'These are matched by the code printed on the battery inside the phone.', '',
    ...productTable(batteries.filter((p) => !named.includes(p))),
    '',
    ...termsBlock(),
  ].join('\n');
  return { title: 'GoldPlus replacement phone batteries', description: `${batteries.length} replacement phone batteries; the fit is confirmed before payment.`, body };
}

/**
 * ONE route table. Both the resolver and the "can this be served as Markdown"
 * check read it, so the Link header can never advertise a document that does
 * not exist — the drift that two parallel path lists invites.
 */
const ROUTES: Array<{ match: (path: string) => boolean; build: (url: URL, path: string) => Promise<AgentDocument | null> }> = [
  { match: (p) => p === '/', build: async () => homeDocument() },
  { match: (p) => p === '/faq', build: async () => faqDocument() },
  { match: (p) => p === '/shop', build: async (url) => shopDocument(url) },
  { match: (p) => p === '/battery-finder', build: async () => batteryFinderDocument() },
  { match: (p) => p === '/returns', build: async () => policyDocument('returns') },
  { match: (p) => p === '/warranty', build: async () => policyDocument('warranty') },
  { match: (p) => p === '/delivery/kampala-wakiso', build: async () => policyDocument('delivery') },
  { match: (p) => p === '/blog', build: async () => blogIndexDocument() },
  { match: (p) => /^\/blog\/[^/]+$/.test(p), build: async (_u, p) => blogPostDocument(p.slice('/blog/'.length)) },
  { match: (p) => /^\/products\/[^/]+$/.test(p), build: async (_u, p) => productDocument2(p.slice('/products/'.length)) },
  { match: (p) => hubMatches(p), build: async (_u, p) => hubDocument(p) },
];

/** Does this path name a hub (or a hub child) we publish? */
function hubMatches(path: string): boolean {
  const segments = path.replace(/^\/+/, '').split('/');
  if (segments.length < 1 || segments.length > 2 || !segments[0]) return false;
  const hub = CATEGORY_HUBS.find((h) => h.slug === segments[0]);
  if (!hub) return false;
  return !segments[1] || Boolean(hub.children?.some((c) => c.slug === segments[1]));
}

async function productDocument2(slug: string): Promise<AgentDocument | null> {
  const res = await fetch(`${apiBase}/products/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
  if (!res.ok) return null;
  const json: any = await res.json().catch(() => null);
  const product: ProductPublicDto | null = json?.success ? json.data : null;
  return product ? productDocument(product) : null;
}

const normalisePath = (pathname: string): string => pathname.replace(/\/+$/, '') || '/';

/** Paths this module can represent. Anything else falls through to the HTML page. */
export async function agentDocumentFor(url: URL): Promise<string | null> {
  const path = normalisePath(url.pathname);
  const route = ROUTES.find((r) => r.match(path));
  if (!route) return null;
  const doc = await route.build(url, path);
  return doc ? renderAgentMarkdown(doc) : null;
}

/**
 * Can this path be served as Markdown? Read by the middleware to advertise the
 * alternate representation — the same table the resolver uses, so the promise
 * is always one it can keep.
 */
export function agentRepresentablePath(pathname: string): boolean {
  const path = normalisePath(pathname);
  return ROUTES.some((r) => r.match(path));
}
