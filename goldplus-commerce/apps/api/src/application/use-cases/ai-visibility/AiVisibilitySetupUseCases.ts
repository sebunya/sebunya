import type { AiAnswerProvider, AiVisibilityRepository, AivProject, AivQuery, CredentialCipher, RunQueue } from '../../ports/AiVisibility';
import type { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import type { ProviderId } from '../../../domain/ai-visibility/Evidence';
import { normalizeHost } from '../../../domain/ai-visibility/Domains';
import { extractEvidence } from '../../../domain/ai-visibility/Evidence';
import { buildEvidenceContext } from './EvidenceContext';

export type Result<T> = { ok: true; value: T } | { ok: false; code: 'NOT_FOUND' | 'BAD_INPUT' | 'CONFLICT' | 'NOT_CONFIGURED' | 'FORBIDDEN' | 'BUDGET' | 'UPSTREAM'; message: string };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(code: Exclude<Result<T>, { ok: true }>['code'], message: string): Result<T> => ({ ok: false, code, message });

export interface Actor { id: string | null; kind: 'USER' | 'SYSTEM' | 'AGENT' | 'SCHEDULER' | 'API_KEY' | 'WEBHOOK' }

const PROVIDERS: readonly ProviderId[] = ['OPENAI', 'ANTHROPIC', 'GEMINI', 'PERPLEXITY'];
const INTENTS = ['COMMERCIAL', 'INFORMATIONAL', 'NAVIGATIONAL', 'TRANSACTIONAL', 'LOCAL', 'COMPARISON', 'UNKNOWN'];
const FUNNEL = ['AWARENESS', 'CONSIDERATION', 'DECISION', 'POST_PURCHASE'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const SOURCES = ['MANUAL', 'SEARCH_CONSOLE', 'RESEARCH', 'AEO_PROMPT_BANK', 'IMPORT'];

export const isProvider = (p: unknown): p is ProviderId => typeof p === 'string' && (PROVIDERS as readonly string[]).includes(p);
const cleanList = (v: unknown, max = 20): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])
  .map((x) => String(x).trim()).filter(Boolean).slice(0, max);

/**
 * Project configuration: brand, domains, budget, pinned competitors, tracked
 * queries and provider settings. Every mutation is audited. Provider keys are
 * encrypted before storage and never returned — only a mask.
 */
export class AiVisibilitySetupUseCases {
  constructor(
    private readonly repo: AiVisibilityRepository,
    private readonly audit: CreateAuditLogUseCase,
    private readonly providers: Record<ProviderId, AiAnswerProvider>,
    private readonly cipher: CredentialCipher | null,
    private readonly queue: RunQueue | null = null,
  ) {}

  /** Re-classification in the background when a queue exists (it can touch every stored answer); inline otherwise. */
  private async requestReclassify(actor: Actor, projectId: string) {
    if (this.queue?.enqueueReclassify && (await this.queue.enqueueReclassify(projectId).catch(() => false))) return;
    await this.reclassify(actor, projectId);
  }

  private async log(actor: Actor, action: string, entity: string, entityId: string, newState: Record<string, unknown>, previousState?: Record<string, unknown> | null) {
    await this.audit.execute({ actorId: actor.id, action, entity, entityId, previousState: previousState ?? null, newState: { ...newState, actorKind: actor.kind } });
  }

  listProjects() { return this.repo.listProjects(); }

  async getProject(idOrSlug: string): Promise<Result<AivProject>> {
    const p = await this.repo.getProject(idOrSlug);
    return p ? ok(p) : fail('NOT_FOUND', 'Project not found.');
  }

  async createProject(actor: Actor, body: Record<string, unknown>): Promise<Result<AivProject>> {
    const name = String(body.name ?? '').trim();
    const brandName = String(body.brandName ?? name).trim();
    const slug = String(body.slug ?? name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const domains = cleanList(body.domains).map((d) => normalizeHost(d)).filter((d): d is string => !!d);
    if (!name || !slug) return fail('BAD_INPUT', 'A project needs a name.');
    if (domains.length === 0) return fail('BAD_INPUT', 'A project needs at least one domain it controls, e.g. example.com.');
    if (await this.repo.getProject(slug)) return fail('CONFLICT', `A project "${slug}" already exists.`);
    const p = await this.repo.createProject({ slug, name, brandName, brandAliases: cleanList(body.brandAliases), domains, marketCountry: String(body.marketCountry ?? 'UG').toUpperCase().slice(0, 2), marketCity: body.marketCity ? String(body.marketCity) : null });
    await this.log(actor, 'AIV_PROJECT_CREATED', 'aiv_project', p.id, { slug, domains });
    return ok(p);
  }

  async updateProject(actor: Actor, projectId: string, body: Record<string, unknown>): Promise<Result<AivProject>> {
    const before = await this.repo.getProject(projectId);
    if (!before) return fail('NOT_FOUND', 'Project not found.');
    const patch: Partial<AivProject> = {};
    if (body.name !== undefined) patch.name = String(body.name).trim() || before.name;
    if (body.brandName !== undefined) patch.brandName = String(body.brandName).trim() || before.brandName;
    if (body.brandAliases !== undefined) patch.brandAliases = cleanList(body.brandAliases);
    if (body.domains !== undefined) {
      const d = cleanList(body.domains).map((x) => normalizeHost(x)).filter((x): x is string => !!x);
      if (d.length === 0) return fail('BAD_INPUT', 'Keep at least one domain the project controls.');
      patch.domains = d;
    }
    if (body.marketCountry !== undefined) patch.marketCountry = String(body.marketCountry).toUpperCase().slice(0, 2);
    if (body.marketCity !== undefined) patch.marketCity = body.marketCity ? String(body.marketCity) : null;
    if (body.budget && typeof body.budget === 'object') {
      const b = body.budget as Record<string, unknown>;
      const n = (k: string, cur: number, max: number) => {
        const v = b[k] === undefined ? cur : Number(b[k]);
        return Number.isFinite(v) && v >= 0 && v <= max ? v : NaN;
      };
      const budget = {
        maxQueriesPerRun: Math.trunc(n('maxQueriesPerRun', before.budget.maxQueriesPerRun, 1000)),
        maxSpendPerRunUsd: n('maxSpendPerRunUsd', before.budget.maxSpendPerRunUsd, 1000),
        maxDailySpendUsd: n('maxDailySpendUsd', before.budget.maxDailySpendUsd, 5000),
        maxMonthlySpendUsd: n('maxMonthlySpendUsd', before.budget.maxMonthlySpendUsd, 50000),
        approvalAboveUsd: n('approvalAboveUsd', before.budget.approvalAboveUsd, 1000),
      };
      if (Object.values(budget).some((v) => Number.isNaN(v)) || budget.maxQueriesPerRun < 1) return fail('BAD_INPUT', 'Budget limits must be non-negative numbers within sane bounds.');
      patch.budget = budget;
    }
    let schedule: { monitor: 'OFF' | 'DAILY' | 'WEEKLY'; setBy: string | null } | undefined;
    if (body.schedule !== undefined) {
      const m = String(body.schedule).toUpperCase();
      if (!['OFF', 'DAILY', 'WEEKLY'].includes(m)) return fail('BAD_INPUT', 'schedule must be OFF, DAILY or WEEKLY.');
      // A schedule spends money without asking each time, so switching it on
      // is itself the approval — only a person may do it, and it is recorded.
      if (m !== 'OFF' && actor.kind !== 'USER') return fail('FORBIDDEN', 'Only a person can switch on a recurring schedule.');
      schedule = { monitor: m as 'OFF' | 'DAILY' | 'WEEKLY', setBy: m === 'OFF' ? null : actor.id };
    }
    const after = await this.repo.updateProject(projectId, { ...patch, ...(schedule ? { schedule } : {}) });
    if (!after) return fail('NOT_FOUND', 'Project not found.');
    await this.log(actor, 'AIV_PROJECT_UPDATED', 'aiv_project', projectId, { ...(patch as Record<string, unknown>), ...(schedule ? { schedule: schedule.monitor } : {}) }, { domains: before.domains, budget: before.budget, schedule: before.schedule.monitor });
    const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
    if (!same(before.domains, after.domains) || before.brandName !== after.brandName || !same(before.brandAliases, after.brandAliases)) {
      await this.requestReclassify(actor, after.id);
    }
    return ok(after);
  }

  // ── Competitors (pins onto the shared seo_competitors registry) ─────────────

  async competitors(projectId: string) {
    const [pinned, registry] = await Promise.all([this.repo.listPinnedCompetitors(projectId), this.repo.listRegistryCompetitors()]);
    const pinnedIds = new Set(pinned.map((c) => c.id));
    return { pinned, available: registry.filter((c) => !pinnedIds.has(c.id) && c.domains.length > 0) };
  }

  async pinCompetitor(actor: Actor, projectId: string, competitorId: string, pin: boolean): Promise<Result<{ pinned: boolean }>> {
    if (!(await this.repo.getProject(projectId))) return fail('NOT_FOUND', 'Project not found.');
    if (pin) {
      const c = (await this.repo.listRegistryCompetitors()).find((x) => x.id === competitorId);
      if (!c) return fail('NOT_FOUND', 'Competitor not found in the registry.');
      if (c.domains.length === 0) return fail('BAD_INPUT', 'Record the competitor\'s website first — a competitor without a domain can never be matched in citations.');
      await this.repo.pinCompetitor(projectId, competitorId);
    } else {
      await this.repo.unpinCompetitor(projectId, competitorId);
    }
    await this.log(actor, pin ? 'AIV_COMPETITOR_PINNED' : 'AIV_COMPETITOR_UNPINNED', 'aiv_project', projectId, { competitorId });
    await this.requestReclassify(actor, projectId);
    return ok({ pinned: pin });
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  listQueries(projectId: string, f: { active?: boolean; search?: string; limit: number; offset: number }) { return this.repo.listQueries(projectId, f); }

  private queryFields(body: Record<string, unknown>): Result<Partial<AivQuery>> {
    const q: Partial<AivQuery> = {};
    if (body.text !== undefined) {
      const t = String(body.text).replace(/\s+/g, ' ').trim();
      if (t.length < 3 || t.length > 500) return fail('BAD_INPUT', 'A question is 3–500 characters.');
      q.text = t;
    }
    if (body.intent !== undefined) { if (!INTENTS.includes(String(body.intent))) return fail('BAD_INPUT', `intent must be one of ${INTENTS.join(', ')}.`); q.intent = String(body.intent); }
    if (body.funnelStage !== undefined) { const f = body.funnelStage ? String(body.funnelStage) : null; if (f && !FUNNEL.includes(f)) return fail('BAD_INPUT', `funnelStage must be one of ${FUNNEL.join(', ')}.`); q.funnelStage = f; }
    if (body.priority !== undefined) { if (!PRIORITIES.includes(String(body.priority))) return fail('BAD_INPUT', 'priority must be P0–P3.'); q.priority = String(body.priority); }
    if (body.source !== undefined) { if (!SOURCES.includes(String(body.source))) return fail('BAD_INPUT', `source must be one of ${SOURCES.join(', ')}.`); q.source = String(body.source); }
    for (const k of ['category', 'topic', 'property', 'marketCity', 'language', 'provenance'] as const) if (body[k] !== undefined) (q as Record<string, unknown>)[k] = body[k] ? String(body[k]).slice(0, 200) : null;
    if (body.marketCountry !== undefined) q.marketCountry = body.marketCountry ? String(body.marketCountry).toUpperCase().slice(0, 2) : null;
    if (body.branded !== undefined) q.branded = Boolean(body.branded);
    if (body.active !== undefined) q.active = Boolean(body.active);
    if (body.tags !== undefined) q.tags = cleanList(body.tags, 20);
    return ok(q);
  }

  async createQuery(actor: Actor, projectId: string, body: Record<string, unknown>): Promise<Result<AivQuery>> {
    const project = await this.repo.getProject(projectId);
    if (!project) return fail('NOT_FOUND', 'Project not found.');
    const f = this.queryFields(body);
    if (!f.ok) return f;
    if (!f.value.text) return fail('BAD_INPUT', 'Write the question as a customer would ask it.');
    const brandish = [project.brandName, ...project.brandAliases].some((a) => f.value.text!.toLowerCase().includes(a.toLowerCase()));
    const row = await this.repo.createQuery(projectId, {
      text: f.value.text, category: f.value.category ?? null, intent: f.value.intent ?? 'UNKNOWN', funnelStage: f.value.funnelStage ?? null,
      branded: f.value.branded ?? brandish, topic: f.value.topic ?? null, property: f.value.property ?? null,
      marketCountry: f.value.marketCountry ?? null, marketCity: f.value.marketCity ?? null, language: f.value.language ?? null,
      source: f.value.source ?? 'MANUAL', provenance: f.value.provenance ?? null, priority: f.value.priority ?? 'P2',
      tags: f.value.tags ?? [], active: f.value.active ?? true, createdBy: actor.id,
    });
    if (!row) return fail('CONFLICT', 'That question is already tracked.');
    await this.log(actor, 'AIV_QUERY_CREATED', 'aiv_query', row.id, { projectId, text: row.text, source: row.source });
    return ok(row);
  }

  async updateQuery(actor: Actor, projectId: string, id: string, body: Record<string, unknown>): Promise<Result<AivQuery>> {
    const f = this.queryFields(body);
    if (!f.ok) return f;
    const row = await this.repo.updateQuery(projectId, id, f.value);
    if (!row) return fail('NOT_FOUND', 'Query not found (or its new text duplicates another tracked query).');
    await this.log(actor, 'AIV_QUERY_UPDATED', 'aiv_query', id, f.value as Record<string, unknown>);
    return ok(row);
  }

  // ── Providers ───────────────────────────────────────────────────────────────

  providerConfigs(projectId: string) { return this.repo.listProviderConfigs(projectId); }

  async updateProvider(actor: Actor, projectId: string, provider: string, body: Record<string, unknown>) {
    if (!isProvider(provider)) return fail('BAD_INPUT', 'Unknown provider.');
    const patch: Record<string, unknown> = {};
    if (body.model !== undefined) { const m = String(body.model).trim(); if (!/^[a-z0-9][a-z0-9.\-_:]{1,80}$/i.test(m)) return fail('BAD_INPUT', 'That does not look like a model id.'); patch.model = m; }
    if (body.webSearch !== undefined) patch.webSearch = Boolean(body.webSearch);
    if (body.estUsdPerCall !== undefined) { const v = Number(body.estUsdPerCall); if (!Number.isFinite(v) || v < 0 || v > 5) return fail('BAD_INPUT', 'Estimated cost per call must be between 0 and 5 USD.'); patch.estUsdPerCall = v; }
    if (body.monthlyCapUsd !== undefined) { const v = body.monthlyCapUsd === null || body.monthlyCapUsd === '' ? null : Number(body.monthlyCapUsd); if (v !== null && (!Number.isFinite(v) || v < 0)) return fail('BAD_INPUT', 'Monthly cap must be a non-negative number.'); patch.monthlyCapUsd = v; }
    if (body.enabled !== undefined) {
      const enable = Boolean(body.enabled);
      if (enable && !(await this.repo.getProviderCredential(projectId, provider))) return fail('NOT_CONFIGURED', 'Add an API key before enabling this provider.');
      patch.enabled = enable;
    }
    const row = await this.repo.updateProviderConfig(projectId, provider, patch);
    if (!row) return fail('NOT_FOUND', 'Provider settings not found for this project.');
    await this.log(actor, 'AIV_PROVIDER_UPDATED', 'aiv_provider_config', row.id, { provider, ...patch });
    return ok(row);
  }

  async setCredential(actor: Actor, projectId: string, provider: string, apiKey: string | null) {
    if (!isProvider(provider)) return fail('BAD_INPUT', 'Unknown provider.');
    if (!this.cipher) return fail('NOT_CONFIGURED', 'The credential vault key (SEO_CREDENTIAL_VAULT_KEY or JWT_SECRET) is not set on the server, so keys cannot be stored safely.');
    const cfg = (await this.repo.listProviderConfigs(projectId)).find((c) => c.provider === provider);
    if (!cfg) return fail('NOT_FOUND', 'Provider settings not found for this project.');
    if (apiKey === null) {
      await this.repo.setProviderCredential(projectId, provider, null, null);
      await this.repo.updateProviderConfig(projectId, provider, { enabled: false });
      await this.log(actor, 'AIV_PROVIDER_CREDENTIAL_REMOVED', 'aiv_provider_config', cfg.id, { provider });
      return ok({ provider, hasCredential: false });
    }
    const key = apiKey.trim();
    const v = this.providers[provider].validateConfiguration({ apiKey: key, model: cfg.model });
    if (!v.ok) return fail('BAD_INPUT', v.reason);
    await this.repo.setProviderCredential(projectId, provider, this.cipher.encrypt(key), this.cipher.mask(key));
    // The key itself is never audited — only that it changed and its mask.
    await this.log(actor, 'AIV_PROVIDER_CREDENTIAL_SET', 'aiv_provider_config', cfg.id, { provider, mask: this.cipher.mask(key) });
    return ok({ provider, hasCredential: true, mask: this.cipher.mask(key) });
  }

  /** A real, minimal call made the way runs make it (web search on) — proves key, model and search access. Costs one small call. */
  async testProvider(actor: Actor, projectId: string, provider: string) {
    if (!isProvider(provider)) return fail('BAD_INPUT', 'Unknown provider.');
    const cfg = (await this.repo.listProviderConfigs(projectId)).find((c) => c.provider === provider);
    const secret = await this.repo.getProviderCredential(projectId, provider);
    if (!cfg || !secret || !this.cipher) return fail('NOT_CONFIGURED', 'Not configured: add an API key first.');
    // Tested exactly as runs will call it — web search included. A key whose
    // organisation has not enabled web search (Anthropic makes it a separate
    // switch) passes a plain call and then fails every real run.
    // A test is a paid call: it obeys the same daily/monthly limits as runs.
    const project = (await this.repo.getProject(projectId)) as AivProject;
    const spent = await this.repo.spendToDate(projectId);
    if (spent.todayUsd + cfg.estUsdPerCall > project.budget.maxDailySpendUsd || spent.monthUsd + cfg.estUsdPerCall > project.budget.maxMonthlySpendUsd
      || (cfg.monthlyCapUsd != null && (spent.providerMonthUsd[provider] ?? 0) + cfg.estUsdPerCall > cfg.monthlyCapUsd)) {
      return fail('BUDGET', 'A test call would exceed a spend limit.');
    }
    const h = await this.providers[provider].healthcheck({ apiKey: this.cipher.decrypt(secret), model: cfg.model, webSearch: cfg.webSearch, timeoutMs: 60_000 });
    const message = h.ok ? `Answered${h.servedModel ? ` as ${h.servedModel}` : ''}.` : h.reason;
    await this.repo.recordProviderHealth(projectId, provider, h.ok ? 'OK' : 'FAILED', message);
    // A successful test is a billed call: it counts towards the spend limits.
    // Billed when it answered, and when it failed after the work was done.
    if (h.ok || h.possiblyBilled) await this.repo.recordSpend({ projectId, provider, kind: 'PROVIDER_TEST', costUsd: cfg.estUsdPerCall, basis: 'ESTIMATE_PER_CALL', actorId: actor.id });
    await this.log(actor, 'AIV_PROVIDER_TESTED', 'aiv_provider_config', cfg.id, { provider, ok: h.ok });
    return h.ok ? ok({ provider, message }) : fail('UPSTREAM', message);
  }

  /**
   * Re-derives who is named and whose page is cited, for every stored answer,
   * from the stored evidence (answer text + source URLs), under the CURRENT
   * brand, domains and pinned competitors. The evidence itself is never
   * touched — only its classification — so changing the domain list or a
   * competitor pin gives consistent history instead of old answers judged by
   * old rules. Answers whose provider returned no sources stay "unknown".
   */
  async reclassify(actor: Actor, projectId: string): Promise<Result<{ answers: number }>> {
    const project = await this.repo.getProject(projectId);
    if (!project) return fail('NOT_FOUND', 'Project not found.');
    const ctx = buildEvidenceContext(project, await this.repo.listPinnedCompetitors(project.id));
    let after: string | null = null;
    let answers = 0;
    let readingsChanged = 0;
    for (;;) {
      const batch = await this.repo.listEvidenceForReclassification(project.id, after, 200);
      if (batch.length === 0) break;
      for (const o of batch) {
        // With the provider's raw reply stored, re-read it with the CURRENT
        // parser (a parser fix then corrects past answers too); otherwise
        // re-classify the stored reading.
        let reading = { answerText: o.answerText ?? '', citationSupport: (o.citationSupport === 'SUPPORTED' ? 'SUPPORTED' : 'UNSUPPORTED') as 'SUPPORTED' | 'UNSUPPORTED', citations: o.citations.map((c) => ({ url: c.url, title: c.title, position: c.position })) };
        let reparsed: { answerText: string; citationSupport: 'SUPPORTED' | 'UNSUPPORTED' } | undefined;
        const adapter = isProvider(o.provider) ? this.providers[o.provider] : null;
        if (o.rawResponse && adapter) {
          try {
            const n = adapter.normalize(o.rawResponse, { model: o.model ?? '' }, o.latencyMs ?? 0, { query: o.queryText, location: null });
            reading = { answerText: n.answerText, citationSupport: n.citationSupport, citations: n.citations.map((c) => ({ url: c.url, title: c.title ?? null, position: c.position ?? null })) };
            reparsed = { answerText: n.answerText, citationSupport: n.citationSupport };
          } catch {
            // an unreadable stored reply keeps its previous reading
          }
        }
        const ev = extractEvidence(reading, ctx);
        const res = await this.repo.replaceClassification({ observationId: o.id, projectId: project.id, brandMentioned: ev.brandMentioned, ownCited: ev.ownCited, citations: ev.citations, brandMention: ev.brandMention, competitorMentions: ev.competitorMentions, reparsed });
        if (res?.readingChanged) readingsChanged += 1;
        answers += 1;
      }
      after = batch[batch.length - 1].id;
    }
    await this.log(actor, 'AIV_EVIDENCE_RECLASSIFIED', 'aiv_project', project.id, { answers, readingsChanged, domains: project.domains });
    return ok({ answers });
  }
}
