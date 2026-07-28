/**
 * tests/e2e/support/catalogue-resolver.ts
 *
 * Resolves a real, approved product from the live test API so browser journeys
 * never depend on a hard-coded slug.
 *
 * The suite previously navigated to /products/power-bank-20000mah, a slug the
 * repository's tracked seed never creates (it creates heavy-duty-power-bank).
 * The journeys therefore failed against the project's own seed data. Inventing a
 * product to satisfy the test is forbidden, so the journey asks the API which
 * products actually exist and asserts generic PDP behaviour against one of them.
 *
 * The public catalogue collection lives at `data`. A monitor that parsed
 * `data.items` caused the production zero-products incident, so `selectDeterministicProduct`
 * rejects that shape explicitly rather than silently reading an empty catalogue.
 */

export interface ResolvedProduct {
  slug: string;
  name: string;
  /** A lowercase word from the product name usable as a search term. */
  searchTerm: string;
  /** Canonical retail price in integer UGX, when the API exposes one. */
  retailPriceUgx: number | null;
  /** The price as the storefront renders it (locale-grouped digits), e.g. "18,000". */
  formattedPrice: string | null;
}

interface ApiProduct {
  slug?: unknown;
  name?: unknown;
  retailPriceUgx?: unknown;
}

export class CatalogueResolutionError extends Error {
  constructor(message: string) {
    super(`CATALOGUE_RESOLUTION_FAILED: ${message}`);
    this.name = 'CatalogueResolutionError';
  }
}

/** Longest alphanumeric word in the name, lowercased — stable for a given name. */
function searchTermFor(name: string): string {
  const words = name.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (words.length === 0) throw new CatalogueResolutionError(`product name yields no search term: "${name}"`);
  return words.reduce((longest, w) => (w.length > longest.length ? w : longest), words[0]);
}

/**
 * Picks one product deterministically from a public catalogue payload.
 *
 * Deterministic means: the same payload always yields the same product,
 * regardless of the order the API returned it in. Slugs are unique, so the
 * lexicographically smallest slug is a stable choice.
 */
export function selectDeterministicProduct(payload: unknown): ResolvedProduct {
  if (payload === null || typeof payload !== 'object') {
    throw new CatalogueResolutionError('response body is not an object');
  }

  const body = payload as Record<string, unknown>;

  if (!('data' in body)) {
    throw new CatalogueResolutionError('response has no "data" collection');
  }

  const collection = body.data;

  if (!Array.isArray(collection)) {
    // Guards the exact production defect: the collection is `data`, never `data.items`.
    const hint =
      collection !== null && typeof collection === 'object' && 'items' in (collection as object)
        ? ' (found "data.items" — the public catalogue collection is "data")'
        : '';
    throw new CatalogueResolutionError(`"data" is not an array${hint}`);
  }

  if (collection.length === 0) {
    throw new CatalogueResolutionError(
      'the approved catalogue is empty — seed the catalogue before running browser journeys',
    );
  }

  const usable = (collection as ApiProduct[])
    .filter(
      (p): p is { slug: string; name: string; retailPriceUgx?: unknown } =>
        typeof p?.slug === 'string' && p.slug.length > 0 && typeof p?.name === 'string' && p.name.length > 0,
    )
    .sort((a, b) => a.slug.localeCompare(b.slug));

  if (usable.length === 0) {
    throw new CatalogueResolutionError('no catalogue entry has both a slug and a name');
  }

  const chosen = usable[0];
  const price = typeof chosen.retailPriceUgx === 'number' && Number.isFinite(chosen.retailPriceUgx)
    ? chosen.retailPriceUgx
    : null;
  return {
    slug: chosen.slug,
    name: chosen.name,
    searchTerm: searchTermFor(chosen.name),
    retailPriceUgx: price,
    // Money is integer UGX; the storefront groups thousands. en-US grouping matches
    // the rendered "18,000" form without importing storefront formatting into the test.
    formattedPrice: price === null ? null : price.toLocaleString('en-US'),
  };
}

/** Fetches the approved catalogue from the live test API and resolves one product. */
export async function resolveApprovedProduct(
  apiBaseUrl: string = process.env.E2E_API_BASE ?? process.env.PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3000',
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedProduct> {
  const url = `${apiBaseUrl.replace(/\/$/, '')}/products?limit=25`;
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new CatalogueResolutionError(
      `could not reach the test API at ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new CatalogueResolutionError(`test API returned ${response.status} for ${url}`);
  }
  return selectDeterministicProduct(await response.json());
}
