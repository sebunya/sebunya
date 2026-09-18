import { describe, it, expect, beforeEach } from 'vitest';
import { AiVisibilitySetupUseCases } from '../../apps/api/src/application/use-cases/ai-visibility/AiVisibilitySetupUseCases';
import { AiVisibilityRunUseCases } from '../../apps/api/src/application/use-cases/ai-visibility/AiVisibilityRunUseCases';
import { AiVisibilityInsightsUseCases } from '../../apps/api/src/application/use-cases/ai-visibility/AiVisibilityInsightsUseCases';
import { AiVisibilityActionUseCases } from '../../apps/api/src/application/use-cases/ai-visibility/AiVisibilityActionUseCases';
import { ProviderCallError, type AiAnswerProvider, type AiVisibilityRepository } from '../../apps/api/src/application/ports/AiVisibility';

/**
 * The first vertical slice, end to end, against an in-memory repository and
 * fake providers: configure -> run -> partial failure -> evidence -> gaps ->
 * recommendation -> action -> approval -> execution -> verification.
 */
let seq = 0;
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const now = () => new Date().toISOString();

function memoryRepo() {
  const s = {
    projects: [] as any[], queries: [] as any[], configs: [] as any[], creds: new Map<string, string>(), runs: [] as any[],
    obs: [] as any[], cites: [] as any[], ments: [] as any[], actions: [] as any[], events: [] as any[], comps: [] as any[], pins: [] as any[],
  };
  const repo: any = {
    s,
    listProjects: async () => s.projects,
    getProject: async (k: string) => s.projects.find((p) => p.id === k || p.slug === k) ?? null,
    updateProject: async (pid: string, p: any) => Object.assign(s.projects.find((x) => x.id === pid), p),
    createProject: async (i: any) => { const p = { ...i, id: id(), language: 'en', budget: { maxQueriesPerRun: 50, maxSpendPerRunUsd: 2, maxDailySpendUsd: 5, maxMonthlySpendUsd: 30, approvalAboveUsd: 1 } }; s.projects.push(p); for (const prov of ['OPENAI', 'ANTHROPIC', 'GEMINI', 'PERPLEXITY']) s.configs.push({ projectId: p.id, id: id(), provider: prov, enabled: false, model: prov === 'ANTHROPIC' ? 'claude-sonnet-5' : 'm', webSearch: true, estUsdPerCall: 0.02, monthlyCapUsd: null, hasCredential: false, credentialMask: null }); return p; },
    listPinnedCompetitors: async (pid: string) => s.comps.filter((c) => s.pins.some((x) => x.p === pid && x.c === c.id)),
    listRegistryCompetitors: async () => s.comps,
    pinCompetitor: async (p: string, c: string) => { s.pins.push({ p, c }); return true; },
    unpinCompetitor: async (p: string, c: string) => { s.pins = s.pins.filter((x) => !(x.p === p && x.c === c)); return true; },
    listQueries: async (pid: string, f: any) => { const rows = s.queries.filter((q) => q.projectId === pid && (f.active === undefined || q.active === f.active)); return { rows, total: rows.length, limit: f.limit, offset: 0 }; },
    getQueries: async (pid: string, ids: string[]) => s.queries.filter((q) => q.projectId === pid && ids.includes(q.id)),
    createQuery: async (pid: string, q: any) => { if (s.queries.some((x) => x.projectId === pid && x.text.toLowerCase() === q.text.toLowerCase())) return null; const r = { ...q, id: id(), projectId: pid, createdAt: now() }; s.queries.push(r); return r; },
    updateQuery: async () => null,
    listProviderConfigs: async (pid: string) => s.configs.filter((c) => c.projectId === pid).map((c) => ({ ...c, hasCredential: s.creds.has(`${pid}|${c.provider}`) })),
    getProviderCredential: async (pid: string, prov: string) => s.creds.get(`${pid}|${prov}`) ?? null,
    updateProviderConfig: async (pid: string, prov: string, p: any) => { const c = s.configs.find((x) => x.projectId === pid && x.provider === prov); if (!c) return null; for (const [k, v] of Object.entries(p)) if (v !== undefined) (c as any)[k] = v; return c; },
    setProviderCredential: async (pid: string, prov: string, ct: string | null) => { if (ct) s.creds.set(`${pid}|${prov}`, ct); else s.creds.delete(`${pid}|${prov}`); },
    recordProviderHealth: async () => undefined,
    spendToDate: async (pid: string) => { const m = s.obs.filter((o) => o.projectId === pid && o.status === 'SUCCEEDED').reduce((a, o) => a + (o.costUsd ?? 0), 0); return { todayUsd: m, monthUsd: m, providerMonthUsd: {} }; },
    findRunByIdempotencyKey: async (pid: string, k: string) => s.runs.find((r) => r.projectId === pid && r.idempotencyKey === k) ?? null,
    findActiveRun: async (pid: string, kind: string) => s.runs.find((r) => r.projectId === pid && r.kind === kind && ['AWAITING_APPROVAL', 'QUEUED', 'RUNNING'].includes(r.status)) ?? null,
    createRun: async (i: any) => { const r = { ...i, id: id(), succeeded: 0, failed: 0, skipped: 0, actualUsd: 0, phase: null, error: null, cancelRequested: false, approvedBy: null, createdAt: now(), startedAt: null, finishedAt: null }; s.runs.push(r); return r; },
    getRun: async (pid: string, rid: string) => s.runs.find((r) => r.projectId === pid && r.id === rid) ?? null,
    getRunById: async (rid: string) => s.runs.find((r) => r.id === rid) ?? null,
    listRuns: async (pid: string, _l: number, _o: number, kind?: string) => { const rows = s.runs.filter((r) => r.projectId === pid && (!kind || r.kind === kind)).reverse(); return { rows, total: rows.length, limit: 20, offset: 0 }; },
    moveRun: async (rid: string, from: string[], to: string, p: any = {}) => { const r = s.runs.find((x) => x.id === rid); if (!r || !from.includes(r.status)) return false; r.status = to; if (p.error !== undefined) r.error = p.error; if (p.approvedBy) r.approvedBy = p.approvedBy; if (p.finished) r.finishedAt = now(); return true; },
    updateRunProgress: async (rid: string, p: any) => Object.assign(s.runs.find((r) => r.id === rid), p),
    requestCancel: async () => true,
    isCancelRequested: async (rid: string) => !!s.runs.find((r) => r.id === rid)?.cancelRequested,
    failStaleRuns: async () => [],
    insertObservation: async (o: any) => {
      const dup = s.obs.find((x) => x.runId === o.runId && x.queryText === o.queryText && x.provider === o.provider);
      if (dup) return { id: dup.id, inserted: false };
      const oid = id();
      s.obs.push({ id: oid, runId: o.runId, projectId: o.projectId, runKind: o.runKind, queryId: o.queryId, queryText: o.queryText, provider: o.provider, model: o.answer?.model ?? null, status: o.status, errorCode: o.errorCode, errorMessage: o.errorMessage, citationSupport: o.answer?.citationSupport ?? null, brandMentioned: o.brandMentioned, ownCited: o.ownCited, citationCount: o.citations.length, costUsd: o.answer?.costUsd ?? null, latencyMs: null, requestedLocation: null, appliedLocation: null, executedAt: new Date(Date.now() + seq).toISOString(), answerText: o.answer?.answerText ?? null, rawMetadata: o.answer?.rawMetadata ?? {} });
      for (const c of o.citations) s.cites.push({ ...c, observationId: oid });
      if (o.brandMention) s.ments.push({ observationId: oid, entityKind: 'BRAND', competitorId: null, ...o.brandMention });
      for (const m of o.competitorMentions) s.ments.push({ observationId: oid, entityKind: 'COMPETITOR', competitorId: m.entityId, ...m });
      return { id: oid, inserted: true };
    },
    listObservations: async (pid: string, f: any) => { const rows = s.obs.filter((o) => o.projectId === pid && (!f.queryId || o.queryId === f.queryId) && (!f.status || o.status === f.status) && (!f.fromIso || o.executedAt >= f.fromIso) && (!f.provider || o.provider === f.provider)).sort((a, b) => b.executedAt.localeCompare(a.executedAt)); return { rows, total: rows.length, limit: f.limit, offset: 0 }; },
    getObservation: async (pid: string, oid: string) => s.obs.find((o) => o.projectId === pid && o.id === oid) ?? null,
    citationsFor: async (ids: string[]) => s.cites.filter((c) => ids.includes(c.observationId)),
    mentionsFor: async (ids: string[]) => s.ments.filter((m) => ids.includes(m.observationId)),
    latestPairs: async (pid: string) => {
      const groups = new Map<string, any[]>();
      for (const o of s.obs.filter((x) => x.projectId === pid && x.runKind !== 'RESEARCH' && x.status === 'SUCCEEDED')) { const k = `${o.queryId}|${o.provider}`; groups.set(k, [...(groups.get(k) ?? []), o]); }
      return [...groups.values()].map((g) => { g.sort((a, b) => b.executedAt.localeCompare(a.executedAt)); return { queryId: g[0].queryId, queryText: g[0].queryText, provider: g[0].provider, current: g[0], previous: g[1] ?? null }; });
    },
    dailySeries: async () => [],
    createAction: async (a: any) => { const r = { ...a, id: id(), approvedBy: null, approvedAt: null, executedBy: null, executedAt: null, verification: null, result: null, createdAt: now(), updatedAt: now() }; s.actions.push(r); return r; },
    getAction: async (pid: string, aid: string) => s.actions.find((a) => a.projectId === pid && a.id === aid) ?? null,
    listActions: async () => ({ rows: s.actions, total: s.actions.length, limit: 50, offset: 0 }),
    moveAction: async (aid: string, from: string, to: string, actor: any, note: string | null, p: any = {}) => { const a = s.actions.find((x) => x.id === aid); if (!a || a.status !== from) return false; a.status = to; for (const [k, v] of Object.entries(p ?? {})) if (v !== undefined) a[k] = v; s.events.push({ aid, from, to, actor, note }); return true; },
    listActionEvents: async (aid: string) => s.events.filter((e) => e.aid === aid),
  };
  return repo as AiVisibilityRepository & { s: typeof s };
}

const audit = { rows: [] as any[], execute: async (x: any) => { audit.rows.push(x); return { ok: true, id: 'x' }; } } as any;
const cipher = { encrypt: (p: string) => `enc:${p}`, decrypt: (c: string) => c.slice(4), mask: () => '••••1234' };
const logger = { debug() {}, info() {}, warn() {}, error() {} };

/** A fake provider that answers from a script keyed by query text. */
function fake(pid: any, script: (q: string) => { text: string; cites: string[] } | Error): AiAnswerProvider {
  return {
    id: pid, displayName: pid, appliesLocation: true,
    validateConfiguration: () => ({ ok: true }),
    healthcheck: async () => ({ ok: true, servedModel: 'm' }),
    executeQuery: async (input) => { const r = script(input.query); if (r instanceof Error) throw r; return { raw: r, latencyMs: 5 }; },
    normalize: (raw: any) => ({ provider: pid, model: 'm', answerText: raw.text, citationSupport: 'SUPPORTED', citations: raw.cites.map((url: string) => ({ url })), appliedLocation: null, usage: { inputTokens: 1, outputTokens: 1, searchCalls: 1 }, costUsd: null, latencyMs: 5, rawMetadata: {} }),
  };
}

describe('AI visibility — first vertical slice', () => {
  let repo: ReturnType<typeof memoryRepo>;
  let queued: string[];
  const user = { id: '11111111-1111-4111-8111-111111111111', kind: 'USER' as const };
  const other = { id: '22222222-2222-4222-8222-222222222222', kind: 'USER' as const };
  const agent = { id: user.id, kind: 'AGENT' as const };
  let providers: any;
  const build = () => {
    const queue = { enqueueRun: async (rid: string) => { queued.push(rid); return true; } };
    const setup = new AiVisibilitySetupUseCases(repo, audit, providers, cipher);
    const runs = new AiVisibilityRunUseCases(repo, audit, providers, cipher, queue, logger, async () => undefined);
    return { setup, runs, insights: new AiVisibilityInsightsUseCases(repo), actions: new AiVisibilityActionUseCases(repo, audit, runs) };
  };

  beforeEach(() => {
    repo = memoryRepo();
    queued = [];
    audit.rows = [];
    providers = {
      OPENAI: fake('OPENAI', (q) => ({ text: `For "${q}", GoldPlus and Oraimo both sell them.`, cites: ['https://ug.oraimo.com/p', 'https://en.wikipedia.org/wiki/Power_bank'] })),
      ANTHROPIC: fake('ANTHROPIC', () => new ProviderCallError('HTTP 401: invalid x-api-key', 401, 'HTTP')),
      GEMINI: fake('GEMINI', () => ({ text: 'x', cites: [] })),
      PERPLEXITY: fake('PERPLEXITY', () => ({ text: 'x', cites: [] })),
    };
    repo.s.comps.push({ id: 'c0000000-0000-4000-8000-000000000001', name: 'Oraimo', aliases: [], domains: ['oraimo.com'], businessType: 'DIRECT_BRAND', directness: 'DIRECT' });
  });

  it('runs the whole loop with evidence behind every step', async () => {
    const { setup, runs, insights, actions } = build();
    // 1–5: project, brand/domain, competitor, question, provider
    const p = await setup.createProject(user, { name: 'GoldPlus', brandName: 'GoldPlus', domains: ['https://www.shopgoldplus.com/'], brandAliases: 'Gold Plus' });
    expect(p.ok && p.value.domains).toEqual(['shopgoldplus.com']);
    const pid = (p as any).value.id;
    expect((await setup.pinCompetitor(user, pid, 'c0000000-0000-4000-8000-000000000001', true)).ok).toBe(true);
    const q = await setup.createQuery(user, pid, { text: 'Where can I buy a power bank in Kampala?', intent: 'COMMERCIAL' });
    expect(q.ok).toBe(true);
    expect((await setup.createQuery(user, pid, { text: 'where can I buy a power bank in kampala?' })).ok).toBe(false); // duplicate
    // A provider cannot be enabled without a key; keys are stored encrypted, returned masked.
    expect((await setup.updateProvider(user, pid, 'OPENAI', { enabled: true })).ok).toBe(false);
    const cred = await setup.setCredential(user, pid, 'OPENAI', 'sk-test-key');
    expect(cred.ok && (cred.value as any).mask).toBe('••••1234');
    expect(audit.rows.some((r) => JSON.stringify(r).includes('sk-test-key'))).toBe(false);
    await setup.setCredential(user, pid, 'ANTHROPIC', 'sk-ant-test');
    await setup.updateProvider(user, pid, 'OPENAI', { enabled: true });
    await setup.updateProvider(user, pid, 'ANTHROPIC', { enabled: true });

    // 6–7: run, progress, duplicate protection
    const started = await runs.start(user, pid, {});
    expect(started.ok && started.value.run.status).toBe('QUEUED');
    const again = await runs.start(user, pid, {});
    expect(again.ok && again.value.created).toBe(false); // same idempotency key -> same run
    const runId = (started as any).value.run.id;
    expect(queued).toEqual([runId]);
    expect((await runs.execute(runId)).status).toBe('PARTIAL'); // Anthropic 401, OpenAI succeeded
    expect((await runs.execute(runId)).status).toBe('NOT_CLAIMED'); // a second worker cannot re-run it
    const run = await runs.getRun(pid, runId);
    expect(run).toMatchObject({ succeeded: 1, failed: 1 });

    // 8–12: persisted, mentioned, not cited, competitor cited, full answer
    const failed = repo.s.obs.find((o) => o.provider === 'ANTHROPIC');
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: 'HTTP_401' });
    const ok = repo.s.obs.find((o) => o.provider === 'OPENAI');
    expect(ok).toMatchObject({ brandMentioned: true, ownCited: false });
    const detail = await insights.answer(pid, ok.id);
    expect(detail.ok && (detail.value as any).citations.map((c: any) => [c.role, c.competitorName])).toEqual([['COMPETITOR', 'Oraimo'], ['THIRD_PARTY', null]]);

    // 14–15: gaps and an evidence-backed recommendation
    const gaps = await insights.gaps(pid);
    expect(gaps.ok && (gaps.value.gaps as any[]).map((g) => g.kind)).toEqual(['COMPETITOR_CITED_NOT_US', 'MENTIONED_NOT_CITED']);
    const rec = (gaps as any).value.recommendations[0];
    expect(rec.evidence.observationIds).toContain(ok.id);
    const summary = await insights.summary(pid);
    expect(summary.ok && (summary.value as any).current).toMatchObject({ mentionRate: 1, citationRate: 0 });
    expect((summary as any).value.nextBestAction.title).toBe(rec.title);

    // Research never touches tracking or KPIs.
    const research = await runs.start(user, pid, { kind: 'RESEARCH', adhocQueries: ['best earbuds under 100k ugx'] });
    await runs.execute((research as any).value.run.id);
    expect(repo.s.queries).toHaveLength(1);
    expect(((await insights.summary(pid)) as any).value.current.answered).toBe(1);

    // Action: agent proposes; the agent cannot approve; the proposer cannot approve; another person can.
    const act = await actions.propose(agent, pid, { category: 'CONTENT_CHANGE', title: rec.title, reason: rec.why, evidence: rec.evidence, mechanism: rec.mechanism });
    const aid = (act as any).value.id;
    await actions.submit(agent, pid, aid);
    expect((await actions.approve(agent, pid, aid, null)).ok).toBe(false);
    expect((await actions.approve(other, pid, aid, 'ok')).ok).toBe(true);
    const done = await actions.execute(user, pid, aid, { result: 'Added a Kampala power-bank answer to /power.', verifyAfterDays: 1 });
    expect(done.ok && done.value.status).toBe('VERIFICATION_PENDING');
    expect((await actions.verify(user, pid, aid)).ok).toBe(false); // window not over
  });

  it('agents cannot start a paid run on their own; budget refusals are audited', async () => {
    const { setup, runs } = build();
    const pid = ((await setup.createProject(user, { name: 'X', domains: 'x.com' })) as any).value.id;
    await setup.createQuery(user, pid, { text: 'what is x?' });
    await setup.setCredential(user, pid, 'OPENAI', 'sk-a');
    await setup.updateProvider(user, pid, 'OPENAI', { enabled: true });
    const r = await runs.start(agent, pid, {});
    expect(r.ok && r.value.run.status).toBe('AWAITING_APPROVAL');
    expect(queued).toEqual([]);
    expect((await runs.approve(agent, pid, (r as any).value.run.id)).ok).toBe(false);
    expect((await runs.approve(user, pid, (r as any).value.run.id)).ok).toBe(true);
    // While that run is still queued, a second one is refused as a duplicate.
    expect((await runs.start(user, pid, { idempotencyKey: 'k1' }))).toMatchObject({ ok: false, code: 'CONFLICT' });
    await runs.execute((r as any).value.run.id);

    await setup.updateProject(user, pid, { budget: { maxSpendPerRunUsd: 0 } });
    const denied = await runs.start(user, pid, { idempotencyKey: 'k2' });
    expect(denied).toMatchObject({ ok: false, code: 'BUDGET' });
    expect(audit.rows.some((a) => a.action === 'AIV_RUN_REFUSED_BUDGET')).toBe(true);
  });

  it('with no provider configured the run is refused as not configured, never simulated', async () => {
    const { setup, runs } = build();
    const pid = ((await setup.createProject(user, { name: 'Y', domains: 'y.com' })) as any).value.id;
    await setup.createQuery(user, pid, { text: 'what is y?' });
    const r = await runs.start(user, pid, {});
    expect(r).toMatchObject({ ok: false, code: 'NOT_CONFIGURED' });
    expect(repo.s.obs).toHaveLength(0);
  });
});
