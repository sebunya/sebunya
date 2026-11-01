/**
 * Citation-gap classification for one (query, provider) pair, from the
 * latest observation and — for LOST_CITATION — the one before it.
 *
 * Every gap names the rule that produced it and carries the observation ids
 * it rests on, so a recommendation can always be traced to answers.
 * Unsupported citation data never produces a citation gap.
 */
export type GapKind =
  /** A pinned competitor is cited; we are not. */
  | 'COMPETITOR_CITED_NOT_US'
  /** The brand is named but none of our pages is cited. */
  | 'MENTIONED_NOT_CITED'
  /** Neither mentioned nor cited, while the answer cites sources. */
  | 'ABSENT'
  /** Our page was cited in the previous run and is not now. */
  | 'LOST_CITATION'
  /** Third-party sources hold every citation (no own, no competitor). */
  | 'THIRD_PARTY_DOMINATED';

export interface GapInputObservation {
  id: string;
  brandMentioned: boolean;
  ownCited: boolean | null;
  competitorsCited: readonly string[];
  thirdPartyCitations: number;
  totalCitations: number;
}

export interface Gap {
  kind: GapKind;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  rule: string;
  observationIds: string[];
  competitorIds: string[];
}

export function classifyGaps(current: GapInputObservation, previous: GapInputObservation | null): Gap[] {
  const gaps: Gap[] = [];
  if (current.ownCited === null) return gaps; // no citation evidence -> no citation gap claimed
  const ids = [current.id];
  if (previous && previous.ownCited === true && current.ownCited === false) {
    gaps.push({ kind: 'LOST_CITATION', severity: 'HIGH', rule: 'own page cited in the previous run, not in this one', observationIds: [previous.id, current.id], competitorIds: [...current.competitorsCited] });
  }
  if (current.ownCited === false && current.competitorsCited.length > 0) {
    gaps.push({ kind: 'COMPETITOR_CITED_NOT_US', severity: current.competitorsCited.length > 1 ? 'HIGH' : 'MEDIUM', rule: `${current.competitorsCited.length} pinned competitor(s) cited, no own page cited`, observationIds: ids, competitorIds: [...current.competitorsCited] });
  }
  if (current.ownCited === false && current.brandMentioned) {
    gaps.push({ kind: 'MENTIONED_NOT_CITED', severity: 'MEDIUM', rule: 'brand named in the answer, no own page among its sources', observationIds: ids, competitorIds: [] });
  }
  if (current.ownCited === false && !current.brandMentioned && current.totalCitations > 0) {
    gaps.push({ kind: 'ABSENT', severity: 'LOW', rule: 'brand neither named nor cited in an answer that cites sources', observationIds: ids, competitorIds: [] });
  }
  if (current.ownCited === false && current.competitorsCited.length === 0 && current.totalCitations > 0 && current.thirdPartyCitations === current.totalCitations) {
    gaps.push({ kind: 'THIRD_PARTY_DOMINATED', severity: 'LOW', rule: 'every cited source is a third party', observationIds: ids, competitorIds: [] });
  }
  return gaps;
}
