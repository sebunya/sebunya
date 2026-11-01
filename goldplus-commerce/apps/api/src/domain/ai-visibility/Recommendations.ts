import type { Gap, GapKind } from './Gaps';

/**
 * Evidence-backed recommendations from gaps. A recommendation is a
 * PROPOSAL: it names the mechanism it relies on and how it would be verified,
 * and states plainly what is not known. It never claims a cause.
 */
export type ActionClass =
  | 'IMPROVE_EXISTING_PAGE' | 'CREATE_LANDING_PAGE' | 'IMPROVE_ENTITY_CLARITY'
  | 'IMPROVE_STRUCTURED_DATA' | 'EARN_THIRD_PARTY_SOURCE' | 'INVESTIGATE_LOST_CITATION';

export interface GapGroup {
  kind: GapKind;
  queryId: string;
  queryText: string;
  providers: string[];
  observationIds: string[];
  competitorIds: string[];
  /** our best-matching page for the query, if the caller found one */
  candidatePage: string | null;
}

export interface Recommendation {
  actionClass: ActionClass;
  title: string;
  why: string;
  mechanism: string;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  effort: 'LOW' | 'MEDIUM' | 'HIGH';
  targetPage: string | null;
  verification: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  limitations: string;
  evidence: { queryId: string; observationIds: string[]; providers: string[]; competitorIds: string[] };
}

const providersText = (p: string[]) => (p.length === 1 ? p[0] : `${p.length} providers (${p.join(', ')})`);

export function recommendFor(g: GapGroup): Recommendation {
  const evidence = { queryId: g.queryId, observationIds: g.observationIds, providers: g.providers, competitorIds: g.competitorIds };
  const verification = `Re-run "${g.queryText}" on ${providersText(g.providers)} after the change has been crawled (allow at least 14 days) and compare citation status with this baseline.`;
  // Confidence rises with independent providers agreeing; one answer is weak evidence.
  const confidence: Recommendation['confidence'] = g.providers.length >= 3 ? 'HIGH' : g.providers.length === 2 ? 'MEDIUM' : 'LOW';
  const limitations = 'AI answers vary between runs and providers; one run is a sample, not a ranking. Timing of any later change does not by itself show that this action caused it.';
  switch (g.kind) {
    case 'LOST_CITATION':
      return { actionClass: 'INVESTIGATE_LOST_CITATION', title: `Find out why our page stopped being cited for "${g.queryText}"`, why: `Our page was cited in the previous run and is not now, on ${providersText(g.providers)}.`, mechanism: 'Check the page still returns 200, is indexable and unchanged; compare the sources cited now with before.', risk: 'LOW', effort: 'LOW', targetPage: g.candidatePage, verification, confidence, limitations, evidence };
    case 'COMPETITOR_CITED_NOT_US':
      return g.candidatePage
        ? { actionClass: 'IMPROVE_EXISTING_PAGE', title: `Make ${g.candidatePage} answer "${g.queryText}" directly`, why: `A pinned competitor is cited for this question and we are not, on ${providersText(g.providers)}.`, mechanism: 'Answer engines cite pages that state the answer plainly and verifiably; compare what the cited competitor page states that ours does not.', risk: 'LOW', effort: 'MEDIUM', targetPage: g.candidatePage, verification, confidence, limitations, evidence }
        : { actionClass: 'CREATE_LANDING_PAGE', title: `Consider a page that answers "${g.queryText}"`, why: `A pinned competitor is cited for this question, we are not, and no page of ours clearly matches it.`, mechanism: 'Without a page that answers the question there is nothing of ours to cite.', risk: 'MEDIUM', effort: 'HIGH', targetPage: null, verification, confidence, limitations, evidence };
    case 'MENTIONED_NOT_CITED':
      return { actionClass: 'IMPROVE_ENTITY_CLARITY', title: `Give answer engines a page of ours to cite for "${g.queryText}"`, why: `The brand is named in the answer but none of our pages is among its sources, on ${providersText(g.providers)}.`, mechanism: 'The engine knows the brand but sources the facts elsewhere; a page stating those facts with structured data is a citable source.', risk: 'LOW', effort: 'MEDIUM', targetPage: g.candidatePage, verification, confidence, limitations, evidence };
    case 'THIRD_PARTY_DOMINATED':
      return { actionClass: 'EARN_THIRD_PARTY_SOURCE', title: `Third-party sources own "${g.queryText}"`, why: 'Every cited source is a third party (publisher, forum, directory).', mechanism: 'Being listed or reviewed on the sources the engine already trusts can matter more than our own page.', risk: 'LOW', effort: 'HIGH', targetPage: null, verification, confidence, limitations, evidence };
    case 'ABSENT':
    default:
      return { actionClass: 'IMPROVE_STRUCTURED_DATA', title: `We are absent from answers to "${g.queryText}"`, why: 'The brand is neither named nor cited in an answer that cites sources.', mechanism: 'Clear entity data (Organization/Product JSON-LD, consistent name and address) helps engines associate the brand with the topic.', risk: 'LOW', effort: 'MEDIUM', targetPage: g.candidatePage, verification, confidence, limitations, evidence };
  }
}

export type { Gap };
