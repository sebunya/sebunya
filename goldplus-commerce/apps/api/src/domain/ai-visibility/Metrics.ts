/**
 * Visibility metrics. Mentions and citations are computed and reported
 * SEPARATELY, each with its own denominator, so either can be inspected on
 * its own. There is no blended "visibility score".
 *
 *  mentionRate   = observations where the brand is mentioned / answered observations
 *  citationRate  = observations citing an own page / observations whose provider SUPPORTS citations
 *  shareOfMentions  = brand mention count / all tracked-entity mention count (brand + pinned competitors)
 *  shareOfCitations = own citations / citations of tracked entities (own + pinned competitors)
 *
 * A rate with a zero denominator is null ("no evidence"), never 0.
 */
export interface MetricObservation {
  provider: string;
  answered: boolean;
  brandMentioned: boolean;
  ownCited: boolean | null;
  competitorMentionIds: readonly string[];
  competitorCitedIds: readonly string[];
  ownCitationCount: number;
  competitorCitationCounts: Readonly<Record<string, number>>;
}

export interface VisibilityMetrics {
  observations: number;
  answered: number;
  mentioned: number;
  mentionRate: number | null;
  citationEligible: number;
  cited: number;
  citationRate: number | null;
  shareOfMentions: number | null;
  shareOfCitations: number | null;
}

const rate = (n: number, d: number): number | null => (d > 0 ? n / d : null);

export function computeMetrics(obs: readonly MetricObservation[]): VisibilityMetrics {
  const answered = obs.filter((o) => o.answered);
  const mentioned = answered.filter((o) => o.brandMentioned).length;
  const eligible = answered.filter((o) => o.ownCited !== null);
  const cited = eligible.filter((o) => o.ownCited === true).length;
  const compMentions = answered.reduce((s, o) => s + o.competitorMentionIds.length, 0);
  const ownCites = eligible.reduce((s, o) => s + o.ownCitationCount, 0);
  const compCites = eligible.reduce((s, o) => s + Object.values(o.competitorCitationCounts).reduce((a, b) => a + b, 0), 0);
  return {
    observations: obs.length,
    answered: answered.length,
    mentioned,
    mentionRate: rate(mentioned, answered.length),
    citationEligible: eligible.length,
    cited,
    citationRate: rate(cited, eligible.length),
    shareOfMentions: rate(mentioned, mentioned + compMentions),
    shareOfCitations: rate(ownCites, ownCites + compCites),
  };
}

/** Per-competitor mention/citation rates over the same observations. */
export function competitorMetrics(obs: readonly MetricObservation[], competitorIds: readonly string[]) {
  const answered = obs.filter((o) => o.answered);
  const eligible = answered.filter((o) => o.ownCited !== null);
  return competitorIds.map((id) => {
    const mentioned = answered.filter((o) => o.competitorMentionIds.includes(id)).length;
    const cited = eligible.filter((o) => o.competitorCitedIds.includes(id)).length;
    return { competitorId: id, mentioned, mentionRate: rate(mentioned, answered.length), cited, citationRate: rate(cited, eligible.length) };
  });
}
