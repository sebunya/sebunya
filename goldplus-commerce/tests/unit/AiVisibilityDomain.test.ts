import { describe, it, expect } from 'vitest';
import { normalizeHost, hostMatchesDomain, pageKey } from '../../apps/api/src/domain/ai-visibility/Domains';
import { detectMentions } from '../../apps/api/src/domain/ai-visibility/Mentions';
import { classifyCitations } from '../../apps/api/src/domain/ai-visibility/Citations';
import { extractEvidence } from '../../apps/api/src/domain/ai-visibility/Evidence';
import { computeMetrics, type MetricObservation } from '../../apps/api/src/domain/ai-visibility/Metrics';
import { classifyGaps } from '../../apps/api/src/domain/ai-visibility/Gaps';
import { evaluateRunBudget, mayContinue, DEFAULT_BUDGET } from '../../apps/api/src/domain/ai-visibility/Budget';
import { finalStatus, canTransition, isRetryable, backoffMs } from '../../apps/api/src/domain/ai-visibility/RunLifecycle';
import { mayApprove, mayExecute, canMove, verificationVerdict, RISK_OF } from '../../apps/api/src/domain/ai-visibility/Actions';
import { recommendFor } from '../../apps/api/src/domain/ai-visibility/Recommendations';

describe('domains', () => {
  it('normalises hosts and matches subdomains, not look-alikes', () => {
    expect(normalizeHost('https://WWW.ShopGoldPlus.com:443/x?y=1')).toBe('shopgoldplus.com');
    expect(normalizeHost('shopgoldplus.com')).toBe('shopgoldplus.com');
    expect(normalizeHost('not a url')).toBeNull();
    expect(hostMatchesDomain('blog.shopgoldplus.com', 'shopgoldplus.com')).toBe(true);
    expect(hostMatchesDomain('notshopgoldplus.com', 'shopgoldplus.com')).toBe(false);
    expect(pageKey('https://www.a.com/p/?utm_source=x#f')).toBe('a.com/p');
    expect(pageKey('https://a.com')).toBe('a.com/');
  });
});

describe('mentions', () => {
  const brand = { id: 'B', name: 'GoldPlus', aliases: ['Gold Plus', 'shopgoldplus.com'] };
  it('matches spacing/hyphen variants and possessives', () => {
    for (const t of ['Try GoldPlus.', 'gold plus power banks', 'Gold-Plus is local', "GoldPlus's warranty", 'see shopgoldplus.com']) {
      expect(detectMentions(t, [brand])).toHaveLength(1);
    }
  });
  it('does not match inside another word', () => {
    expect(detectMentions('GoldPlusMax and Goldplusser are other things', [brand])).toHaveLength(0);
    expect(detectMentions('the gold standard plus more', [brand])).toHaveLength(0);
  });
  it('ignores aliases under 3 characters and reports first position and count', () => {
    const hits = detectMentions('Oraimo, then Oraimo again', [{ id: 'O', name: 'Oraimo', aliases: ['OR'] }]);
    expect(hits[0]).toMatchObject({ entityId: 'O', firstIndex: 0, occurrences: 2 });
  });
});

describe('citations', () => {
  const comps = [{ competitorId: 'C1', domains: ['jumia.ug'] }];
  it('classifies own, competitor, third party and source kinds; dedupes pages', () => {
    const out = classifyCitations([
      { url: 'https://shopgoldplus.com/power' },
      { url: 'https://www.jumia.ug/baseus/' },
      { url: 'https://en.wikipedia.org/wiki/Power_bank' },
      { url: 'https://someblog.co.ug/x' },
      { url: 'https://shopgoldplus.com/power?ref=chatgpt' },
    ], ['shopgoldplus.com'], comps);
    expect(out.map((c) => c.role)).toEqual(['OWN', 'COMPETITOR', 'THIRD_PARTY', 'THIRD_PARTY']);
    expect(out[1].competitorId).toBe('C1');
    expect(out[2].sourceKind).toBe('ENCYCLOPEDIA');
    expect(out[3].sourceKind).toBeNull();
  });
});

describe('evidence: mentions and citations stay separate', () => {
  const ctx = { brand: { id: 'B', name: 'GoldPlus' }, ownDomains: ['shopgoldplus.com'], competitors: [{ id: 'C1', name: 'Oraimo', domains: ['oraimo.com'] }] };
  it('mentioned but not cited', () => {
    const e = extractEvidence({ answerText: 'GoldPlus and Oraimo sell chargers.', citationSupport: 'SUPPORTED', citations: [{ url: 'https://ug.oraimo.com/x' }] }, ctx);
    expect(e.brandMentioned).toBe(true);
    expect(e.ownCited).toBe(false);
    expect(e.competitorsCited).toEqual(['C1']);
  });
  it('unsupported citations are unknown (null), never false', () => {
    const e = extractEvidence({ answerText: 'No sources here.', citationSupport: 'UNSUPPORTED', citations: [] }, ctx);
    expect(e.ownCited).toBeNull();
  });
});

describe('metrics', () => {
  const o = (p: Partial<MetricObservation>): MetricObservation => ({ provider: 'OPENAI', answered: true, brandMentioned: false, ownCited: false, competitorMentionIds: [], competitorCitedIds: [], ownCitationCount: 0, competitorCitationCounts: {}, ...p });
  it('keeps separate denominators; unsupported answers are excluded from citation rate', () => {
    const m = computeMetrics([o({ brandMentioned: true, ownCited: true, ownCitationCount: 1 }), o({ ownCited: null }), o({ answered: false })]);
    expect(m.mentionRate).toBe(0.5);
    expect(m.citationEligible).toBe(1);
    expect(m.citationRate).toBe(1);
  });
  it('no evidence is null, not zero', () => {
    const m = computeMetrics([]);
    expect(m.mentionRate).toBeNull();
    expect(m.citationRate).toBeNull();
  });
});

describe('gaps', () => {
  const g = (p: Record<string, unknown>) => ({ id: 'o2', brandMentioned: false, ownCited: false as boolean | null, competitorsCited: [] as string[], thirdPartyCitations: 0, totalCitations: 0, ...p });
  it('detects lost citation, competitor-cited and mentioned-not-cited', () => {
    const kinds = classifyGaps(g({ brandMentioned: true, competitorsCited: ['C1'], totalCitations: 1 }), g({ id: 'o1', ownCited: true })).map((x) => x.kind);
    expect(kinds).toEqual(['LOST_CITATION', 'COMPETITOR_CITED_NOT_US', 'MENTIONED_NOT_CITED']);
  });
  it('claims no citation gap without citation evidence', () => {
    expect(classifyGaps(g({ ownCited: null, competitorsCited: ['C1'] }), null)).toEqual([]);
  });
  it('third-party dominated when every source is a third party', () => {
    expect(classifyGaps(g({ totalCitations: 3, thirdPartyCitations: 3 }), null).map((x) => x.kind)).toContain('THIRD_PARTY_DOMINATED');
  });
});

describe('budget', () => {
  const plan = (q: number, calls: number, est = 0.05) => ({ queryCount: q, callsByProvider: { OPENAI: calls }, estimateUsdPerCall: { OPENAI: est } });
  const zero = { todayUsd: 0, monthUsd: 0, providerMonthUsd: {} };
  it('refuses empty, over-query, over-run, over-day and over-month plans', () => {
    expect(evaluateRunBudget(plan(0, 0), DEFAULT_BUDGET, zero).allowed).toBe(false);
    expect(evaluateRunBudget(plan(51, 51), DEFAULT_BUDGET, zero).allowed).toBe(false);
    expect(evaluateRunBudget(plan(10, 10, 0.5), DEFAULT_BUDGET, zero).allowed).toBe(false);
    expect(evaluateRunBudget(plan(10, 10), DEFAULT_BUDGET, { ...zero, todayUsd: 4.9 }).allowed).toBe(false);
    expect(evaluateRunBudget(plan(10, 10), DEFAULT_BUDGET, { ...zero, monthUsd: 29.9 }).allowed).toBe(false);
  });
  it('flags approval above the threshold, and a provider cap binds', () => {
    const d = evaluateRunBudget(plan(30, 30), DEFAULT_BUDGET, zero);
    expect(d).toMatchObject({ allowed: true, requiresApproval: true });
    expect(evaluateRunBudget(plan(10, 10), { ...DEFAULT_BUDGET, providerMonthlyUsd: { OPENAI: 0.1 } }, zero).allowed).toBe(false);
    expect(mayContinue(1.99, 0.05, DEFAULT_BUDGET, zero)).toBe(false);
  });
});

describe('run lifecycle', () => {
  it('one provider failing makes a run PARTIAL, not FAILED', () => {
    expect(finalStatus({ total: 4, succeeded: 2, failed: 2, skipped: 0, pending: 0 }, false)).toBe('PARTIAL');
    expect(finalStatus({ total: 4, succeeded: 0, failed: 4, skipped: 0, pending: 0 }, false)).toBe('FAILED');
    expect(finalStatus({ total: 4, succeeded: 4, failed: 0, skipped: 0, pending: 0 }, false)).toBe('COMPLETED');
    expect(finalStatus({ total: 4, succeeded: 0, failed: 0, skipped: 4, pending: 0 }, true)).toBe('CANCELLED');
  });
  it('terminal states do not move; retries only on transient errors', () => {
    expect(canTransition('COMPLETED', 'RUNNING')).toBe(false);
    expect(canTransition('AWAITING_APPROVAL', 'QUEUED')).toBe(true);
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(401)).toBe(false);
    expect(isRetryable(null, 'TIMEOUT')).toBe(true);
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(10)).toBe(20_000);
  });
});

describe('actions and approvals', () => {
  it('only a person approves, never their own proposal, only when awaiting', () => {
    expect(mayApprove({ approverKind: 'AGENT', approverId: 'a', proposerId: 'b', status: 'AWAITING_APPROVAL' }).ok).toBe(false);
    expect(mayApprove({ approverKind: 'USER', approverId: 'a', proposerId: 'a', status: 'AWAITING_APPROVAL' }).ok).toBe(false);
    expect(mayApprove({ approverKind: 'USER', approverId: 'a', proposerId: 'b', status: 'DRAFT' }).ok).toBe(false);
    expect(mayApprove({ approverKind: 'USER', approverId: 'a', proposerId: 'b', status: 'AWAITING_APPROVAL' }).ok).toBe(true);
  });
  it('publishing is never executed by an agent; nothing executes unapproved', () => {
    expect(mayExecute({ status: 'APPROVED', risk: RISK_OF.INDEXING_SUBMISSION, actorKind: 'AGENT' }).ok).toBe(false);
    expect(mayExecute({ status: 'AWAITING_APPROVAL', risk: 'EDIT', actorKind: 'USER' }).ok).toBe(false);
    expect(mayExecute({ status: 'APPROVED', risk: 'EDIT', actorKind: 'AGENT' }).ok).toBe(true);
    expect(canMove('VERIFIED', 'DRAFT')).toBe(false);
  });
  it('verification is before/after and says it is not causal', () => {
    const v = verificationVerdict({ cited: 0, eligible: 4 }, { cited: 2, eligible: 4 });
    expect(v.status).toBe('VERIFIED');
    expect(v.summary).toMatch(/not that one caused the other/);
    expect(verificationVerdict({ cited: 1, eligible: 2 }, { cited: 0, eligible: 0 }).status).toBe('NOT_VERIFIED');
  });
  it('recommendations name evidence, mechanism, verification and limitations', () => {
    const r = recommendFor({ kind: 'COMPETITOR_CITED_NOT_US', queryId: 'q', queryText: 'power bank kampala', providers: ['OPENAI'], observationIds: ['o'], competitorIds: ['c'], candidatePage: null });
    expect(r.actionClass).toBe('CREATE_LANDING_PAGE');
    expect(r.evidence.observationIds).toEqual(['o']);
    expect(r.confidence).toBe('LOW');
    expect(r.limitations).toMatch(/does not by itself show/);
  });
});

describe('competitor mention aliases (registry names are descriptive)', () => {
  it('derives the names answers actually use', async () => {
    const { competitorMentionAliases, detectMentions } = await import('../../apps/api/src/domain/ai-visibility/Mentions');
    const cases: Array<[any, string, boolean]> = [
      [{ name: 'Oraimo Uganda', domains: ['ug.oraimo.com', 'oraimo.com'] }, 'Oraimo power banks are popular.', true],
      [{ name: 'Samsung Uganda Direct', domains: ['samsung.com'] }, 'Buy a Samsung charger.', true],
      [{ name: 'Jumia Uganda', domains: ['jumia.ug', 'jumia.co.ug'] }, 'Order it on Jumia.', true],
      [{ name: 'Anker', aliases: ['Anker Uganda Outlet (via Abanista)'], domains: ['anker.com'] }, 'Anker cables last.', true],
      [{ name: 'Computers.co.ug', domains: ['computers.co.ug'] }, 'Laptops and computers are sold here.', false],
      [{ name: 'MoMo Market', domains: ['market.momo.africa'] }, 'MoMo Market sells phones.', true],
    ];
    for (const [c, text, expected] of cases) {
      const hits = detectMentions(text, [{ id: 'x', name: c.name, aliases: [...(c.aliases ?? []), ...competitorMentionAliases(c)] }]);
      expect(hits.length > 0, `${c.name} in "${text}"`).toBe(expected);
    }
    expect(competitorMentionAliases({ name: 'X', domains: ['jumia.co.ug'] })).toContain('jumia');
  });
});
