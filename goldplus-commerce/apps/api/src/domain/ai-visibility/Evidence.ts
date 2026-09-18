import { classifyCitations, type ClassifiedCitation, type CompetitorDomains, type RawCitation } from './Citations';
import { detectMentions, type MentionEntity, type MentionHit } from './Mentions';

/**
 * The normalised result of asking ONE provider ONE query in ONE run: the
 * unit of evidence. Stored immutably; a later run adds a new observation and
 * never rewrites this one.
 */
export type ProviderId = 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'PERPLEXITY';

/**
 * Whether the provider exposes sources for this answer. UNSUPPORTED (the
 * adapter/mode cannot return sources) is NOT the same as SUPPORTED with zero
 * sources: an unsupported answer is excluded from citation-rate denominators.
 */
export type CitationSupport = 'SUPPORTED' | 'UNSUPPORTED';

export interface NormalizedAnswer {
  provider: ProviderId;
  model: string;
  answerText: string;
  citationSupport: CitationSupport;
  citations: RawCitation[];
  /** Location the provider says it applied, when it says so; null = not applied / unknown. */
  appliedLocation: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null; searchCalls: number | null };
  costUsd: number | null;
  latencyMs: number;
  rawMetadata: Record<string, unknown>;
}

export interface EvidenceContext {
  brand: MentionEntity;
  ownDomains: readonly string[];
  competitors: ReadonlyArray<MentionEntity & { domains: readonly string[] }>;
}

export interface ObservationEvidence {
  brandMentioned: boolean;
  brandMention: MentionHit | null;
  competitorMentions: MentionHit[];
  /** null when the provider did not support citations for this answer. */
  ownCited: boolean | null;
  citations: ClassifiedCitation[];
  citedDomains: string[];
  competitorsCited: string[];
}

export function extractEvidence(answer: Pick<NormalizedAnswer, 'answerText' | 'citationSupport' | 'citations'>, ctx: EvidenceContext): ObservationEvidence {
  const brandHits = detectMentions(answer.answerText, [ctx.brand]);
  const compHits = detectMentions(answer.answerText, ctx.competitors);
  const comps: CompetitorDomains[] = ctx.competitors.map((c) => ({ competitorId: c.id, domains: c.domains }));
  const supported = answer.citationSupport === 'SUPPORTED';
  const citations = supported ? classifyCitations(answer.citations, ctx.ownDomains, comps) : [];
  return {
    brandMentioned: brandHits.length > 0,
    brandMention: brandHits[0] ?? null,
    competitorMentions: compHits,
    ownCited: supported ? citations.some((c) => c.role === 'OWN') : null,
    citations,
    citedDomains: [...new Set(citations.map((c) => c.host))],
    competitorsCited: [...new Set(citations.filter((c) => c.competitorId).map((c) => c.competitorId as string))],
  };
}
