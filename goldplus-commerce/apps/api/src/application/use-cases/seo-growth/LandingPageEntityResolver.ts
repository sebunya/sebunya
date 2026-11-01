/**
 * Landing-page entity resolution: what GoldPlus thing does a Search Console
 * URL actually represent?
 *
 * The first attempt at this matched category slugs as path segments, which was
 * a guess about the storefront rather than knowledge of it. Real Search Console
 * data settled it immediately: the storefront serves `/products/<slug>` and
 * `/shop?category=power`, while the internal category slug is `power-devices`.
 * Nothing matched, and observed demand reached no opportunity at all.
 *
 * The correction is to resolve URLs the way the storefront resolves them. The
 * shop page calls `normalizeCategoryParam(value, taxonomy)`, which maps an
 * alias to a canonical taxonomy slug — `power` -> `power-devices` — and that
 * canonical slug is what the catalogue knows. This module reuses that exact
 * semantics rather than inventing a second URL ontology.
 *
 * Three rules it will not bend:
 *
 *   Only GoldPlus-owned hosts may receive attribution. A foreign host is
 *   rejected outright, and nothing here ever fetches a URL — resolution is
 *   parse and lookup only.
 *
 *   An unknown slug is UNMAPPED. There is no nearest-match, because guessing
 *   which product a query belonged to is worse than admitting we don't know.
 *
 *   The homepage is the homepage. Google sending a query to `/` proves the
 *   homepage received it, not that any category owns the intent.
 */

import { isAllowedUrl, buildAllowlist } from './CrawlSiteUseCase';

export const PAGE_TYPES = ['PRODUCT', 'CATEGORY', 'HOME', 'OTHER_INTERNAL', 'UNMAPPED', 'REJECTED'] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const RESOLUTION_METHODS = [
  /** /products/<slug> matched a catalogue product. */
  'PRODUCT_SLUG',
  /** ?category=<key> resolved through the taxonomy alias map. */
  'TAXONOMY_ALIAS',
  /** ?category=<slug> was already a canonical taxonomy slug. */
  'TAXONOMY_SLUG',
  /** The site root. */
  'HOME_ROUTE',
  /** A GoldPlus page we recognise but that carries no commercial entity. */
  'INTERNAL_ROUTE',
  /** Parsed fine, but nothing in the catalogue corresponds to it. */
  'NO_MATCH',
  /** Not a GoldPlus URL, or not a URL at all. */
  'UNTRUSTED_HOST',
] as const;
export type ResolutionMethod = (typeof RESOLUTION_METHODS)[number];

export interface ResolvedLandingPage {
  /** The URL after normalisation, or null when it could not be parsed. */
  normalizedUrl: string | null;
  pageType: PageType;
  entityType: 'PRODUCT' | 'CATEGORY' | 'HOME' | null;
  /** Canonical identity: product id, category slug, or '/' for home. */
  entityId: string | null;
  method: ResolutionMethod;
  /**
   * How much weight downstream attribution may place on this. A product slug
   * that matched the catalogue is certain; an internal page we merely
   * recognise is not evidence about any entity.
   */
  confidence: number;
  reason: string;
}

/** What the resolver needs to know about the storefront. Supplied, not fetched. */
export interface RouteTruth {
  /** Canonical taxonomy slug -> itself, and every alias -> canonical slug. */
  categoryByKey: Map<string, string>;
  /** Product slug -> stable product id. */
  productIdBySlug: Map<string, string>;
  /** Canonical category slugs the opportunity universe actually contains. */
  knownCategorySlugs: Set<string>;
}

/**
 * Query parameters that identify WHICH page this is. Everything else is
 * campaign or presentation noise and is dropped, so the same page tracked two
 * ways is still one page.
 */
const SEMANTIC_PARAMS = new Set(['category', 'subcategory']);

/** Analytics/campaign parameters — never part of page identity. */
const TRACKING_PARAM_PREFIXES = ['utm_', 'gclid', 'fbclid', 'msclkid', 'mc_', '_ga', 'ref', 'gad_', 'gbraid', 'wbraid'];

const isTracking = (key: string) => {
  const k = key.toLowerCase();
  return TRACKING_PARAM_PREFIXES.some((p) => k === p || k.startsWith(p));
};

/**
 * Canonical form: https, no `www.`, no fragment, no trailing slash (except
 * root), tracking parameters removed, semantic parameters preserved and
 * sorted so ordering cannot create two identities for one page.
 */
export function normalizeLandingUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(String(raw ?? '').trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  u.hash = '';
  u.username = '';
  u.password = '';
  u.port = '';

  const kept: Array<[string, string]> = [];
  for (const [k, v] of u.searchParams) {
    if (isTracking(k)) continue;
    // Only parameters that change WHICH page this is survive; a sort order is
    // the same page presented differently.
    if (SEMANTIC_PARAMS.has(k.toLowerCase())) kept.push([k.toLowerCase(), v.trim().toLowerCase()]);
  }
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  u.search = '';
  for (const [k, v] of kept) u.searchParams.append(k, v);

  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
  if (u.pathname === '') u.pathname = '/';

  return u.toString();
}

const unresolved = (
  pageType: PageType, method: ResolutionMethod, reason: string, normalizedUrl: string | null,
): ResolvedLandingPage => ({ normalizedUrl, pageType, entityType: null, entityId: null, method, confidence: 0, reason });

export function resolveLandingPage(rawUrl: string, truth: RouteTruth, allowlist?: string[]): ResolvedLandingPage {
  const list = allowlist ?? buildAllowlist();

  // SSRF gate first, reusing the crawler's proven check: http(s) only,
  // allowlisted hostname, never an IP literal. A URL that fails here can never
  // receive attribution, whatever it looks like.
  if (!isAllowedUrl(String(rawUrl ?? ''), list)) {
    return unresolved('REJECTED', 'UNTRUSTED_HOST', 'Not a GoldPlus-owned host; no entity attribution is possible.', null);
  }

  const normalizedUrl = normalizeLandingUrl(rawUrl);
  if (!normalizedUrl) {
    return unresolved('REJECTED', 'UNTRUSTED_HOST', 'URL could not be parsed.', null);
  }

  const u = new URL(normalizedUrl);
  const segments = u.pathname.split('/').filter(Boolean);

  // Home.
  if (segments.length === 0) {
    return {
      normalizedUrl, pageType: 'HOME', entityType: 'HOME', entityId: '/',
      method: 'HOME_ROUTE', confidence: 1,
      // Deliberately NOT attributed to a category: Google sent the query to
      // the homepage, which says nothing about which category owns the intent.
      reason: 'The site root received this demand. That is page evidence, not evidence about any product or category.',
    };
  }

  // /products/<slug>
  if (segments[0] === 'products' && segments[1]) {
    const slug = decodeURIComponent(segments[1]).toLowerCase();
    const productId = truth.productIdBySlug.get(slug) ?? null;
    if (!productId) {
      return unresolved('UNMAPPED', 'NO_MATCH', `No catalogue product has the slug "${slug}". Guessing a nearest match would be worse than reporting it unmapped.`, normalizedUrl);
    }
    return {
      normalizedUrl, pageType: 'PRODUCT', entityType: 'PRODUCT', entityId: productId,
      method: 'PRODUCT_SLUG', confidence: 1,
      reason: 'The path is a canonical product route and the slug matches a catalogue product exactly.',
    };
  }

  // /shop?category=<key>  — resolved the way the shop page itself resolves it.
  if (segments[0] === 'shop') {
    const key = (u.searchParams.get('category') ?? '').trim().toLowerCase();
    if (!key) {
      return unresolved('OTHER_INTERNAL', 'INTERNAL_ROUTE', 'Unfiltered shop listing: a GoldPlus page, but not evidence about a specific category.', normalizedUrl);
    }
    const canonical = truth.categoryByKey.get(key) ?? null;
    if (!canonical) {
      return unresolved('UNMAPPED', 'NO_MATCH', `"${key}" is neither a taxonomy slug nor a known alias.`, normalizedUrl);
    }
    if (!truth.knownCategorySlugs.has(canonical)) {
      // The storefront knows this category but the opportunity universe does
      // not, so there is nothing to attribute demand to yet.
      return unresolved('UNMAPPED', 'NO_MATCH', `"${key}" resolves to taxonomy category "${canonical}", which has no corresponding catalogue category.`, normalizedUrl);
    }
    return {
      normalizedUrl, pageType: 'CATEGORY', entityType: 'CATEGORY', entityId: `/${canonical}`,
      method: key === canonical ? 'TAXONOMY_SLUG' : 'TAXONOMY_ALIAS', confidence: key === canonical ? 1 : 0.9,
      reason: key === canonical
        ? `The shop filter names canonical taxonomy category "${canonical}".`
        : `The shop filter uses the alias "${key}", which the taxonomy maps to "${canonical}" — the same resolution the storefront performs.`,
    };
  }

  return unresolved('OTHER_INTERNAL', 'INTERNAL_ROUTE', 'A GoldPlus page that carries no commercial entity identity.', normalizedUrl);
}

/** Attribution outcome for one observation. States partition the total. */
export const ATTRIBUTION_STATES = ['ATTRIBUTED', 'PARTIAL', 'UNMAPPED'] as const;
export type AttributionState = (typeof ATTRIBUTION_STATES)[number];

export function attributionStateOf(resolved: ResolvedLandingPage): AttributionState {
  if (resolved.entityType === 'PRODUCT' || resolved.entityType === 'CATEGORY') return 'ATTRIBUTED';
  // Home and other internal pages are real GoldPlus evidence, but not evidence
  // about a commercial entity — that is PARTIAL, not nothing and not certain.
  if (resolved.pageType === 'HOME' || resolved.pageType === 'OTHER_INTERNAL') return 'PARTIAL';
  return 'UNMAPPED';
}
