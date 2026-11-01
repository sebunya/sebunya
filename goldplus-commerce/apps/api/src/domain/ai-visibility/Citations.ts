import { matchDomain, normalizeHost, pageKey } from './Domains';

/**
 * CITATION classification. A citation is a source/link the answer engine
 * attached to its answer. Only what the provider actually returned is a
 * citation — nothing is inferred from URLs merely written in the answer text
 * unless the provider presents them as sources (see provider adapters).
 *
 * Every cited domain is one of:
 *   OWN         — a domain the project controls
 *   COMPETITOR  — a domain of a PINNED competitor (chosen by an operator)
 *   THIRD_PARTY — anything else. A third party is NOT a competitor: news
 *                 sites, Wikipedia, Reddit, directories and marketplaces are
 *                 usually SOURCES. `sourceKind` says which, where known.
 */
export type CitationRole = 'OWN' | 'COMPETITOR' | 'THIRD_PARTY';
export type SourceKind =
  | 'ENCYCLOPEDIA' | 'FORUM' | 'VIDEO' | 'SOCIAL' | 'NEWS' | 'MARKETPLACE'
  | 'DIRECTORY' | 'REVIEW' | 'GOVERNMENT' | 'OTHER';

export interface RawCitation {
  url: string;
  title?: string | null;
  /** 1-based order in the provider's source list, when the provider orders them. */
  position?: number | null;
}

export interface CompetitorDomains {
  competitorId: string;
  domains: readonly string[];
}

export interface ClassifiedCitation {
  url: string;
  title: string | null;
  position: number | null;
  host: string;
  pageKey: string;
  role: CitationRole;
  competitorId: string | null;
  sourceKind: SourceKind | null;
}

/** Well-known source hosts. Deliberately small and factual; extend by data, not guesswork. */
const SOURCE_KINDS: Array<[string, SourceKind]> = [
  ['wikipedia.org', 'ENCYCLOPEDIA'],
  ['reddit.com', 'FORUM'], ['quora.com', 'FORUM'], ['stackexchange.com', 'FORUM'],
  ['youtube.com', 'VIDEO'], ['youtu.be', 'VIDEO'], ['tiktok.com', 'VIDEO'],
  ['facebook.com', 'SOCIAL'], ['instagram.com', 'SOCIAL'], ['x.com', 'SOCIAL'], ['twitter.com', 'SOCIAL'], ['linkedin.com', 'SOCIAL'],
  ['amazon.com', 'MARKETPLACE'], ['aliexpress.com', 'MARKETPLACE'], ['temu.com', 'MARKETPLACE'], ['ebay.com', 'MARKETPLACE'],
  ['yelp.com', 'REVIEW'], ['trustpilot.com', 'REVIEW'], ['tripadvisor.com', 'REVIEW'],
  ['go.ug', 'GOVERNMENT'], ['gov.uk', 'GOVERNMENT'], ['gov', 'GOVERNMENT'],
];

export function sourceKindOf(host: string): SourceKind | null {
  for (const [suffix, kind] of SOURCE_KINDS) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return kind;
  }
  return null;
}

export function classifyCitations(
  citations: readonly RawCitation[],
  ownDomains: readonly string[],
  competitors: readonly CompetitorDomains[],
): ClassifiedCitation[] {
  const out: ClassifiedCitation[] = [];
  const seen = new Set<string>();
  citations.forEach((c, i) => {
    const host = normalizeHost(c.url);
    const key = pageKey(c.url);
    if (!host || !key) return;
    // One page cited twice in a list is one citation (first position kept).
    if (seen.has(key)) return;
    seen.add(key);
    const own = matchDomain(host, ownDomains);
    const comp = own ? null : competitors.find((x) => matchDomain(host, x.domains));
    out.push({
      url: c.url,
      title: c.title ?? null,
      position: c.position ?? i + 1,
      host,
      pageKey: key,
      role: own ? 'OWN' : comp ? 'COMPETITOR' : 'THIRD_PARTY',
      competitorId: comp?.competitorId ?? null,
      sourceKind: own || comp ? null : sourceKindOf(host),
    });
  });
  return out;
}
