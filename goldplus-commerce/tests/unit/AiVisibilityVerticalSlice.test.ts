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
    // Copies, like a real database read: callers must never share the stored object.
    getProject: async (k: string) => { const p = s.projects.find((x) => x.id === k || x.slug === k); return p ? structuredClone(p) : null; },
    updateProject: async (pid: string, p: any) => { const x = s.projects.find((y) => y.id === pid); const { schedule, ...rest } = p; Object.assign(x, rest); if (schedule) x.schedule = { ...x.schedule, ...schedule }; return x; },
    dueScheduledProjects: async () => s.projects.filter((x) => x.schedule.monitor !== 'OFF' && !x.schedule.lastScheduledAt),
    markScheduled: async (pid: string) => { s.projects.find((x) => x.id === pid).schedule.lastScheduledAt = now(); },
    createProject: async (i: any) => { const p = { ...i, id: id(), language: 'en', budget: { maxQueriesPerRun: 50, maxSpendPerRunUsd: 2, maxDailySpendUsd: 5, maxMonthlySpendUsd: 30, approvalAboveUsd: 1 }, schedule: { monitor: 'OFF', setBy: null, lastScheduledAt: null } }; s.projects.push(p); for (const prov of ['OPENAI', 'ANTHROPIC', 'GEMINI', 'PERPLEXITY']) s.configs.push({ projectId: p.id, id: id(), provider: prov, enabled: false, model: prov === 'ANTHROPIC' ? 'claude-sonnet-5' : 'm', webSearch: true, estUsdPerCall: 0.02, monthlyCapUsd: null, hasCredential: false, credentialMask: null }); return p; },
    listPinnedCompetitors: async (pid: string) => s.comps.filter((c) => s.pins.some((x) => x.p === pid && x.c === c.id)),
    listRegistryCompetitors: async () => s.comps,
    pinCompetitor: async (p: string, c: string) => { s.pins.push({ p, c }); return true; },
    unpinCompetitor: async (p: string, c: string) => { s.pins = s.pins.filter((x) => !(x.p === p && x.c === c)); return true; },
    listQueries: async (pid: string, f: any) => { const rows = s.queries.filter((q) => q.projectId === pid && (f.active === undefined || q.active === f.active)); return { rows, total: rows.length, limit: f.limit, offset: 0 }; },
    getQueries: async (pid: string, ids: string[]) => s.queries.filter((q) => q.projectId === pid && ids.includes(q.id)),
    createQuery: async (pid: string, q: any) => { if (s.queries.some((x) => x.projectId === pid && x.text.toLowerCase() === q.text.toLowerCase())) return null; const r = { ...q, id: id(), projectId: pid, createdAt: now() }; s.queries.push(r); return r; },
    updateQuery: async (pid: string, qid: string, p: any) => { const q = s.queries.find((x) => x.projectId === pid && x.id === qid); if (!q) return null; Object.assign(q, p); return q; },
    listProviderConfigs: async (pid: string) => s.configs.filter((c) => c.projectId === pid).map((c) => ({ ...c, hasCredential: s.creds.has(`${pid}|${c.provider}`) })),
    getProviderCredential: async (pid: string, prov: string) => s.creds.get(`${pid}|${prov}`) ?? null,
    updateProviderConfig: async (pid: string, prov: string, p: any) => { const c = s.configs.find((x) => x.projectId === pid && x.provider === prov); if (!c) return null; for (const [k, v] of Object.entries(p)) if (v !== undefined) (c as any)[k] = v; return c; },
    setProviderCredential: async (pid: string, prov: string, ct: string | null) => { if (ct) s.creds.set(`${pid}|${prov}`, ct); else s.creds.delete(`${pid}|${prov}`); },
    recordProviderHealth: async () => undefined,
    ledger: [] as any[],
    spendToDate: async (pid: string) => { const m = s.obs.filter((o) => o.projectId === pid).reduce((a, o) => a + (o.costUsd ?? 0), 0) + repo.ledger.filter((l: any) => l.projectId === pid).reduce((a: number, l: any) => a + l.costUsd, 0); return { todayUsd: m, monthUsd: m, providerMonthUsd: {} }; },
    recordSpend: async (e: any) => { repo.ledger.push(e); },
    listEvidenceForReclassification: async (pid: string, after: string | null) => s.obs.filter((o) => o.projectId === pid && o.status === 'SUCCEEDED' && (!after || o.id > after)).sort((a, b) => a.id.localeCompare(b.id)).map((o) => ({ id: o.id, provider: o.provider, model: o.model, queryText: o.queryText, latencyMs: null, rawResponse: o.rawMetadata?.rawResponse ?? null, answerText: o.answerText, citationSupport: o.citationSupport, citations: s.cites.filter((c) => c.observationId === o.id).map((c) => ({ url: c.url, title: c.title ?? null, position: c.position ?? null })) })),
    replaceClassification: async (x: any) => {
      s.cites = s.cites.filter((c) => c.observationId !== x.observationId); s.ments = s.ments.filter((m) => m.observationId !== x.observationId);
      for (const c of x.citations) s.cites.push({ ...c, observationId: x.observationId });
      if (x.brandMention) s.ments.push({ observationId: x.observationId, entityKind: 'BRAND', competitorId: null, ...x.brandMention });
      for (const m of x.competitorMentions) s.ments.push({ observationId: x.observationId, entityKind: 'COMPETITOR', competitorId: m.entityId, ...m });
      Object.assign(s.obs.find((o) => o.id === x.observationId), { brandMentioned: x.brandMentioned, ownCited: x.ownCited, citationCount: x.citations.length }, x.reparsed ? { answerText: x.reparsed.answerText, citationSupport: x.reparsed.citationSupport } : {});
    },
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
      s.obs.push({ id: oid, runId: o.runId, projectId: o.projectId, runKind: o.runKind, queryId: o.queryId, queryText: o.queryText, provider: o.provider, model: o.answer?.model ?? null, status: o.status, errorCode: o.errorCode, errorMessage: o.errorMessage, citationSupport: o.answer?.citationSupport ?? null, brandMentioned: o.brandMentioned, ownCited: o.ownCited, citationCount: o.citations.length, costUsd: o.answer?.costUsd ?? o.costUsd ?? null, latencyMs: null, requestedLocation: null, appliedLocation: null, executedAt: new Date(Date.now() + seq).toISOString(), answerText: o.answer?.answerText ?? null, rawMetadata: o.answer?.rawMetadata ?? {} });
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
      for (const o of s.obs.filter((x) => x.projectId === pid && x.runKind !== 'RESEARCH' && x.status === 'SUCCEEDED' && s.queries.some((q) => q.id === x.queryId && q.active))) { const k = `${o.queryId}|${o.provider}`; groups.set(k, [...(groups.get(k) ?? []), o]); }
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
const alerts = { rows: [] as any[], cleared: [] as string[], raise: async (a: any) => { alerts.rows.push(a); }, clear: async (k: string) => { alerts.cleared.push(k); } };

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
    const runs = new AiVisibilityRunUseCases(repo, audit, providers, cipher, queue, logger, alerts, async () => undefined);
    return { setup, runs, insights: new AiVisibilityInsightsUseCases(repo), actions: new AiVisibilityActionUseCases(repo, audit, runs) };
  };

  beforeEach(() => {
    repo = memoryRepo();
    queued = [];
    audit.rows = [];
    alerts.rows = [];
    alerts.cleared = [];
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
    // One question here; with more, the rest would be skipped, not re-asked (see the next test).
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
    // The drafted recommendation is marked, and is no longer offered as the next best action.
    const after = (await insights.gaps(pid)) as any;
    expect(after.value.recommendations.find((r: any) => r.title === rec.title).existingActionId).toBe(aid);
    expect(((await insights.summary(pid)) as any).value.nextBestAction?.title).not.toBe(rec.title);
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

  it('schedules: only a person switches one on; the tick runs within budget; alerts on lost citations', async () => {
    const { setup, runs } = build();
    const pid = ((await setup.createProject(user, { name: 'S', domains: 'shopgoldplus.com', brandName: 'GoldPlus' })) as any).value.id;
    await setup.createQuery(user, pid, { text: 'power bank kampala' });
    await setup.setCredential(user, pid, 'OPENAI', 'sk-a');
    await setup.updateProvider(user, pid, 'OPENAI', { enabled: true });
    expect((await setup.updateProject(agent, pid, { schedule: 'DAILY' })).ok).toBe(false);
    expect((await setup.updateProject(user, pid, { schedule: 'DAILY' })).ok).toBe(true);
    // First run cites us; the scheduled run does not -> CITATION_LOST alert.
    let cite = true;
    providers.OPENAI = fake('OPENAI', () => ({ text: 'GoldPlus.', cites: cite ? ['https://shopgoldplus.com/power'] : ['https://jumia.ug/x'] }));
    const r1 = await build().runs.start(user, pid, { idempotencyKey: 'manual-baseline' });
    await build().runs.execute((r1 as any).value.run.id);
    cite = false;
    const tick = await build().runs.runSchedules();
    expect(tick).toEqual({ started: 1, refused: 0 });
    const sched = repo.s.runs.find((r) => r.actorKind === 'SCHEDULER');
    expect(sched.status).toBe('QUEUED'); // within budget, a person switched it on -> no approval
    await build().runs.execute(sched.id);
    expect(alerts.rows.map((a) => a.kind)).toContain('AIV_CITATION_LOST');
    // The lost-citation recommendation names the page that used to be cited.
    const lostRec = ((await build().insights.gaps(pid)) as any).value.recommendations.find((r: any) => r.actionClass === 'INVESTIGATE_LOST_CITATION');
    expect(lostRec.targetPage).toBe('https://shopgoldplus.com/power');
    expect((await build().runs.runSchedules()).started).toBe(0); // not due again
    // The report is built from the same evidence and carries its method notes.
    const rep = await build().insights.report(pid);
    expect(rep.ok && (rep.value as any).whatChanged.map((m: any) => m.kind)).toContain('CITATION_LOST');
    expect((rep as any).value.method.join(' ')).toMatch(/do not by themselves show/);
  });

  it('spend is re-read before every call: another run spending at the same time stops this one at the limit', async () => {
    const { setup, runs } = build();
    const pid = ((await setup.createProject(user, { name: 'L', domains: 'l.com' })) as any).value.id;
    await setup.createQuery(user, pid, { text: 'first question' });
    await setup.createQuery(user, pid, { text: 'second question' });
    await setup.setCredential(user, pid, 'OPENAI', 'sk-a');
    await setup.updateProvider(user, pid, 'OPENAI', { enabled: true });
    await setup.updateProject(user, pid, { budget: { maxDailySpendUsd: 0.05 } }); // plan: 2 x $0.02 fits
    let calls = 0;
    providers.OPENAI = fake('OPENAI', () => {
      calls += 1;
      // A concurrent research run records $0.03 while this run is going.
      if (calls === 1) repo.s.obs.push({ id: 'other', projectId: pid, status: 'SUCCEEDED', costUsd: 0.03, runKind: 'RESEARCH', executedAt: new Date(0).toISOString() });
      return { text: 'x', cites: [] };
    });
    const r = await build().runs.start(user, pid, {});
    expect((await build().runs.execute((r as any).value.run.id)).status).toBe('PARTIAL');
    expect(calls).toBe(1); // the second call would have taken the day to $0.07
    expect(repo.s.obs.find((o) => o.status === 'SKIPPED')?.errorMessage).toBe('Stopped by the spend limit.');
  });

  it('a refused key stops that provider after the first failure; the others carry on', async () => {
    const { setup } = build();
    const pid = ((await setup.createProject(user, { name: 'K', domains: 'k.com' })) as any).value.id;
    for (const t of ['question one', 'question two', 'question three']) await setup.createQuery(user, pid, { text: t });
    for (const [p, k] of [['OPENAI', 'sk-a'], ['ANTHROPIC', 'sk-ant-b']]) { await setup.setCredential(user, pid, p, k); await setup.updateProvider(user, pid, p, { enabled: true }); }
    let claudeCalls = 0;
    providers.ANTHROPIC = fake('ANTHROPIC', () => { claudeCalls += 1; return new ProviderCallError('HTTP 401: invalid x-api-key', 401, 'HTTP'); });
    const r = await build().runs.start(user, pid, {});
    expect((await build().runs.execute((r as any).value.run.id)).status).toBe('PARTIAL');
    expect(claudeCalls).toBe(1);
    const claude = repo.s.obs.filter((o) => o.provider === 'ANTHROPIC').map((o) => o.status);
    expect(claude.sort()).toEqual(['FAILED', 'SKIPPED', 'SKIPPED']);
    expect(repo.s.obs.filter((o) => o.provider === 'OPENAI' && o.status === 'SUCCEEDED')).toHaveLength(3);
  });

  it('every cost counts: provider tests, and timeouts that may have been billed (never a refused key)', async () => {
    const { setup } = build();
    const pid = ((await setup.createProject(user, { name: 'C', domains: 'c.com' })) as any).value.id;
    await setup.createQuery(user, pid, { text: 'question one' });
    for (const [p, k] of [['OPENAI', 'sk-a'], ['ANTHROPIC', 'sk-ant-b']]) { await setup.setCredential(user, pid, p, k); await setup.updateProvider(user, pid, p, { enabled: true }); }
    expect((await setup.testProvider(user, pid, 'OPENAI')).ok).toBe(true);
    expect((await repo.spendToDate(pid)).todayUsd).toBeCloseTo(0.02);
    let tries = 0;
    providers.OPENAI = fake('OPENAI', () => (++tries < 3 ? new ProviderCallError('No answer within 90s.', null, 'TIMEOUT') : { text: 'x', cites: [] }));
    providers.ANTHROPIC = fake('ANTHROPIC', () => new ProviderCallError('HTTP 401: bad key', 401, 'HTTP'));
    const r = await build().runs.start(user, pid, {});
    await build().runs.execute((r as any).value.run.id);
    const oa = repo.s.obs.find((o) => o.provider === 'OPENAI');
    expect(oa.costUsd).toBeCloseTo(0.06); // answer + two timed-out attempts
    expect(repo.s.obs.find((o) => o.provider === 'ANTHROPIC').costUsd).toBeNull(); // refused: not billed
  });

  it('changing our domain re-classifies stored answers; the evidence itself is untouched', async () => {
    const { setup } = build();
    const pid = ((await setup.createProject(user, { name: 'D', brandName: 'GoldPlus', domains: 'old-site.com' })) as any).value.id;
    await setup.createQuery(user, pid, { text: 'power banks' });
    await setup.setCredential(user, pid, 'OPENAI', 'sk-a');
    await setup.updateProvider(user, pid, 'OPENAI', { enabled: true });
    providers.OPENAI = fake('OPENAI', () => ({ text: 'Gold Plus has them.', cites: ['https://shopgoldplus.com/power'] }));
    const r = await build().runs.start(user, pid, {});
    await build().runs.execute((r as any).value.run.id);
    const o = repo.s.obs.find((x) => x.projectId === pid);
    expect(o.ownCited).toBe(false);
    const text = o.answerText;
    expect((await setup.updateProject(user, pid, { domains: 'old-site.com, shopgoldplus.com' })).ok).toBe(true);
    expect(o.ownCited).toBe(true);
    expect(o.answerText).toBe(text);
    expect(repo.s.cites.filter((c) => c.observationId === o.id).map((c) => c.role)).toEqual(['OWN']);
    expect(audit.rows.some((a) => a.action === 'AIV_EVIDENCE_RECLASSIFIED')).toBe(true);
  });

  it('a paused question leaves the figures; a regained citation closes its alert', async () => {
    const { setup } = build();
    const pid = ((await setup.createProject(user, { name: 'P', brandName: 'GoldPlus', domains: 'shopgoldplus.com' })) as any).value.id;
    const q1 = ((await setup.createQuery(user, pid, { text: 'question one' })) as any).value;
    await setup.createQuery(user, pid, { text: 'question two' });
    await setup.setCredential(user, pid, 'OPENAI', 'sk-a');
    await setup.updateProvider(user, pid, 'OPENAI', { enabled: true });
    let cite = true;
    providers.OPENAI = fake('OPENAI', () => ({ text: 'x', cites: cite ? ['https://shopgoldplus.com/a'] : ['https://other.com/'] }));
    const run = async (key: string) => { const r = await build().runs.start(user, pid, { idempotencyKey: key }); await build().runs.execute((r as any).value.run.id); };
    await run('r1'); cite = false; await run('r2');
    expect(alerts.rows.map((a) => a.kind)).toContain('AIV_CITATION_LOST');
    cite = true; await run('r3');
    expect(alerts.cleared).toContain(`AIV_CITATION_LOST:${pid}`);
    expect(((await build().insights.summary(pid)) as any).value.current.answered).toBe(2);
    await setup.updateQuery(user, pid, q1.id, { active: false });
    expect(((await build().insights.summary(pid)) as any).value.current.answered).toBe(1);
  });

  it('a parser fixed after the fact corrects past answers from the stored raw reply', async () => {
    const { setup } = build();
    const pid = ((await setup.createProject(user, { name: 'R', brandName: 'GoldPlus', domains: 'shopgoldplus.com' })) as any).value.id;
    await setup.createQuery(user, pid, { text: 'power banks' });
    await setup.setCredential(user, pid, 'OPENAI', 'sk-a');
    await setup.updateProvider(user, pid, 'OPENAI', { enabled: true });
    const good = fake('OPENAI', () => ({ text: 'Try GoldPlus.', cites: ['https://shopgoldplus.com/power'] }));
    // A buggy parser: reads the text but misses the sources.
    providers.OPENAI = { ...good, normalize: (raw: any, cfg: any, l: number, i: any) => ({ ...good.normalize(raw, cfg, l, i), citations: [] }) };
    const r = await build().runs.start(user, pid, {});
    await build().runs.execute((r as any).value.run.id);
    const o = repo.s.obs.find((x) => x.projectId === pid);
    expect(o.ownCited).toBe(false);
    expect(o.rawMetadata.rawResponse).toBeTruthy();
    providers.OPENAI = good; // the parser is fixed
    expect((await setup.reclassify(user, pid)).ok).toBe(true);
    expect(o.ownCited).toBe(true);
    const detail = (await build().insights.answer(pid, o.id)) as any;
    expect(detail.value.rawMetadata.rawResponse).toBeUndefined(); // not shipped to the answer view
    expect(detail.value.rawMetadata.rawResponseStored).toBe(true);
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
