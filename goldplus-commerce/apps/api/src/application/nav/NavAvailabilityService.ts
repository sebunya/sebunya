import type { NavConfig, Taxonomy } from '@goldplus/shared';

/** What the header needs to know before it advertises a link: does it land on anything? */
export interface NavAvailability {
  /** Product count per chip href, keyed by the href exactly as the config states it. */
  counts: Record<string, number>;
  /** Products behind the finder's own action (the "all batteries" query). */
  finderTotal: number;
}

/** The one thing this service needs from the catalogue — the query a nav link runs. */
export interface NavProductCounter {
  execute(opts: { limit?: number; search?: string; category?: string }): Promise<unknown[]>;
}

/**
 * A nav link's count MUST come from the same query the link itself runs, or the
 * gate lies in both directions — hiding a chip whose page has results, or showing
 * one whose page is empty. So we re-run the href's own `category`/`q`, we do not
 * re-implement matching over a single fetched page.
 *
 * Capped: a gate only needs "is there anything", so a bounded page is enough and
 * the count is reported as "at least this many".
 */
const COUNT_CAP = 24;

/** Pull the catalogue query back out of a nav href. Returns null for a dead/odd link. */
export function navHrefQuery(href: string): { category?: string; search?: string } | null {
  if (!href || !href.startsWith('/')) return null;
  let url: URL;
  try {
    url = new URL(href, 'https://nav.local');
  } catch {
    return null;
  }
  const category = url.searchParams.get('category') ?? undefined;
  const search = url.searchParams.get('q') ?? undefined;
  if (!category && !search) return null;
  return { category, search };
}

/** Where the taxonomy comes from; the shop resolves category aliases through it. */
export interface TaxonomyProvider {
  getPublicConfig(): Promise<Taxonomy>;
}

/**
 * Resolve a category the way `/shop` does — through the taxonomy's aliases.
 *
 * The nav links say `category=power`; the catalogue stores `power-devices` and
 * carries `power` only as an ALIAS. Counting the raw param therefore returned 0
 * for every Power link, which would have hidden the finder even with batteries
 * in stock. The count must resolve exactly what the customer's URL resolves to.
 */
export function resolveCategory(raw: string | undefined, taxonomy: Taxonomy): string | undefined {
  if (!raw) return undefined;
  const candidate = raw.trim().toLowerCase();
  const canonical =
    taxonomy.find((t) => t.slug === candidate)?.slug ??
    taxonomy.find((t) => (t.aliases ?? []).some((a) => a.toLowerCase() === candidate))?.slug;
  // An unknown category is not "no filter" — that would count the whole shop
  // and claim stock the link cannot show.
  return canonical ?? raw;
}

export class NavAvailabilityService {
  constructor(
    private readonly counter: NavProductCounter,
    private readonly taxonomy?: TaxonomyProvider,
  ) {}

  private async countFor(href: string, taxonomy: Taxonomy): Promise<number> {
    const query = navHrefQuery(href);
    if (!query) return 0;
    try {
      const rows = await this.counter.execute({
        ...query,
        category: resolveCategory(query.category, taxonomy),
        limit: COUNT_CAP,
      });
      return rows.length;
    } catch {
      // A catalogue failure must not be read as "we stock this". Fail closed:
      // the caller keeps its last good answer, and a first-ever failure hides
      // the panel rather than shipping links that may go nowhere.
      return 0;
    }
  }

  /** Counts for the battery finder's chips and its own action, from the live catalogue. */
  async forBatteryFinder(config: NavConfig): Promise<NavAvailability> {
    const finder = config.panels.find((p) => p.batteryFinder)?.batteryFinder;
    if (!finder) return { counts: {}, finderTotal: 0 };

    const taxonomy = (await this.taxonomy?.getPublicConfig().catch(() => [])) ?? [];
    const hrefs = Array.from(new Set(finder.brandChips.map((c) => c.href)));
    const counted = await Promise.all(
      hrefs.map(async (h) => [h, await this.countFor(h, taxonomy)] as const),
    );

    return {
      counts: Object.fromEntries(counted),
      finderTotal: await this.countFor(finder.formAction, taxonomy),
    };
  }
}
