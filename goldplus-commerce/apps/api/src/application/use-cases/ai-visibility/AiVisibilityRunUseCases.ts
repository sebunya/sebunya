import { ProviderCallError, type AiAnswerProvider, type AiVisibilityRepository, type AivProject, type AivRun, type AlertSink, type CredentialCipher, type RunQueue } from '../../ports/AiVisibility';
import type { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import type { ILogger } from '../../ports/ILogger';
import type { ProviderId } from '../../../domain/ai-visibility/Evidence';
import { extractEvidence } from '../../../domain/ai-visibility/Evidence';
import { competitorMentionAliases } from '../../../domain/ai-visibility/Mentions';
import { evaluateRunBudget, mayContinue } from '../../../domain/ai-visibility/Budget';
import { backoffMs, finalStatus, isRetryable } from '../../../domain/ai-visibility/RunLifecycle';
import { fail, isProvider, ok, type Actor, type Result } from './AiVisibilitySetupUseCases';

const MAX_ATTEMPTS = 3;
const CALL_TIMEOUT_MS = 90_000;
const MAX_ADHOC = 20;

const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

export interface StartRunInput {
  kind?: 'MONITOR' | 'RESEARCH' | 'VERIFICATION';
  providers?: string[];
  queryIds?: string[];
  adhocQueries?: string[];
  idempotencyKey?: string;
  actionId?: string | null;
}

/**
 * The run engine. Planning is synchronous (validate, cost, budget, dedupe,
 * approval gate); execution happens on the worker queue. Machine actors can
 * never start a paid run on their own: their runs wait for a person.
 */
export class AiVisibilityRunUseCases {
  constructor(
    private readonly repo: AiVisibilityRepository,
    private readonly audit: CreateAuditLogUseCase,
    private readonly providers: Record<ProviderId, AiAnswerProvider>,
    private readonly cipher: CredentialCipher | null,
    private readonly queue: RunQueue,
    private readonly logger: ILogger,
    private readonly alerts: AlertSink | null = null,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async start(actor: Actor, projectId: string, input: StartRunInput): Promise<Result<{ run: AivRun; created: boolean }>> {
    const project = await this.repo.getProject(projectId);
    if (!project) return fail('NOT_FOUND', 'Project not found.');
    const kind = input.kind ?? 'MONITOR';
    if (!['MONITOR', 'RESEARCH', 'VERIFICATION'].includes(kind)) return fail('BAD_INPUT', 'kind must be MONITOR, RESEARCH or VERIFICATION.');

    const configs = await this.repo.listProviderConfigs(project.id);
    const requested = (input.providers ?? []).filter(isProvider);
    const usable = configs.filter((c) => c.enabled && c.hasCredential && (requested.length === 0 || requested.includes(c.provider)));
    if (usable.length === 0) return fail('NOT_CONFIGURED', 'Not configured: no AI provider is enabled with an API key for this project.');
    if (!this.cipher) return fail('NOT_CONFIGURED', 'Not configured: the credential vault key is not set on the server.');

    let queryIds: string[] = [];
    let adhoc: string[] = [];
    if (kind === 'RESEARCH') {
      // Research questions are asked once and are NOT added to tracking.
      adhoc = [...new Set((input.adhocQueries ?? []).map((q) => String(q).replace(/\s+/g, ' ').trim()).filter((q) => q.length >= 3 && q.length <= 500))].slice(0, MAX_ADHOC);
      if (adhoc.length === 0) return fail('BAD_INPUT', 'A research run needs at least one question (3–500 characters).');
    } else {
      const ids = input.queryIds && input.queryIds.length > 0 ? input.queryIds : null;
      const rows = ids ? await this.repo.getQueries(project.id, ids) : (await this.repo.listQueries(project.id, { active: true, limit: 1000, offset: 0 })).rows;
      queryIds = rows.filter((q) => q.active || ids).map((q) => q.id);
      if (queryIds.length === 0) return fail('BAD_INPUT', 'No active tracked questions. Add the questions customers actually ask first.');
    }
    const queryCount = kind === 'RESEARCH' ? adhoc.length : queryIds.length;

    const providers = usable.map((c) => c.provider).sort();
    const key = input.idempotencyKey?.trim()
      || `${kind}:${providers.join(',')}:${hash([...queryIds].sort().join('|') + adhoc.join('|'))}:${this.now().toISOString().slice(0, 13)}`;
    const existing = await this.repo.findRunByIdempotencyKey(project.id, key);
    if (existing) return ok({ run: existing, created: false });
    const active = await this.repo.findActiveRun(project.id, kind);
    if (active) return fail('CONFLICT', `A ${kind.toLowerCase()} run is already ${active.status.toLowerCase().replace('_', ' ')} (${active.id}). Wait for it or cancel it.`);

    const plan = {
      queryCount,
      callsByProvider: Object.fromEntries(usable.map((c) => [c.provider, queryCount])),
      estimateUsdPerCall: Object.fromEntries(usable.map((c) => [c.provider, c.estUsdPerCall])),
    };
    const policy = { ...project.budget, providerMonthlyUsd: Object.fromEntries(usable.filter((c) => c.monthlyCapUsd != null).map((c) => [c.provider, c.monthlyCapUsd as number])) };
    const decision = evaluateRunBudget(plan, policy, await this.repo.spendToDate(project.id));
    if (!decision.allowed) {
      await this.audit.execute({ actorId: actor.id, action: 'AIV_RUN_REFUSED_BUDGET', entity: 'aiv_project', entityId: project.id, newState: { kind, reason: decision.reason, estimatedUsd: decision.estimatedUsd, actorKind: actor.kind } });
      return fail('BUDGET', decision.reason);
    }
    // A person, or the schedule a person switched on, may spend within the
    // limits without asking again. Agents, API keys and webhooks never may.
    const needsApproval = decision.requiresApproval || !(actor.kind === 'USER' || actor.kind === 'SCHEDULER');
    const run = await this.repo.createRun({
      projectId: project.id, kind, status: needsApproval ? 'AWAITING_APPROVAL' : 'QUEUED', idempotencyKey: key,
      providers, queryIds, adhocQueries: adhoc, totalTasks: queryCount * providers.length,
      estimatedUsd: decision.estimatedUsd, requestedBy: actor.id, actorKind: actor.kind, actionId: input.actionId ?? null,
    });
    await this.audit.execute({ actorId: actor.id, action: 'AIV_RUN_REQUESTED', entity: 'aiv_run', entityId: run.id, newState: { kind, providers, queryCount, estimatedUsd: decision.estimatedUsd, status: run.status, actorKind: actor.kind } });
    if (!needsApproval) await this.dispatch(run);
    return ok({ run: (await this.repo.getRunById(run.id)) ?? run, created: true });
  }

  private async dispatch(run: AivRun) {
    const queued = await this.queue.enqueueRun(run.id);
    if (!queued) await this.repo.moveRun(run.id, ['QUEUED'], 'FAILED', { error: 'The background queue is unavailable; the run was not started.', finished: true });
  }

  async approve(actor: Actor, projectId: string, runId: string): Promise<Result<AivRun>> {
    const run = await this.repo.getRun(projectId, runId);
    if (!run) return fail('NOT_FOUND', 'Run not found.');
    if (actor.kind !== 'USER') return fail('FORBIDDEN', 'Only a person can approve a run that spends provider budget.');
    if (run.requestedBy && run.requestedBy === actor.id && run.actorKind === 'USER') return fail('FORBIDDEN', 'Someone other than the requester must approve an over-threshold run.');
    // Budget is re-checked at approval time: spend may have moved since the request.
    const project = (await this.repo.getProject(projectId)) as AivProject;
    const spent = await this.repo.spendToDate(projectId);
    if (spent.todayUsd + run.estimatedUsd > project.budget.maxDailySpendUsd || spent.monthUsd + run.estimatedUsd > project.budget.maxMonthlySpendUsd) {
      return fail('BUDGET', 'Approving now would exceed the daily or monthly spend limit.');
    }
    if (!(await this.repo.moveRun(run.id, ['AWAITING_APPROVAL'], 'QUEUED', { approvedBy: actor.id ?? undefined }))) return fail('CONFLICT', `The run is ${run.status}, not awaiting approval.`);
    await this.audit.execute({ actorId: actor.id, action: 'AIV_RUN_APPROVED', entity: 'aiv_run', entityId: run.id, newState: { estimatedUsd: run.estimatedUsd } });
    const fresh = (await this.repo.getRunById(run.id)) as AivRun;
    await this.dispatch(fresh);
    return ok((await this.repo.getRunById(run.id)) as AivRun);
  }

  async reject(actor: Actor, projectId: string, runId: string): Promise<Result<AivRun>> {
    const run = await this.repo.getRun(projectId, runId);
    if (!run) return fail('NOT_FOUND', 'Run not found.');
    if (!(await this.repo.moveRun(run.id, ['AWAITING_APPROVAL'], 'REJECTED', { finished: true }))) return fail('CONFLICT', `The run is ${run.status}, not awaiting approval.`);
    await this.audit.execute({ actorId: actor.id, action: 'AIV_RUN_REJECTED', entity: 'aiv_run', entityId: run.id, newState: { actorKind: actor.kind } });
    return ok((await this.repo.getRunById(run.id)) as AivRun);
  }

  async cancel(actor: Actor, projectId: string, runId: string): Promise<Result<AivRun>> {
    const run = await this.repo.getRun(projectId, runId);
    if (!run) return fail('NOT_FOUND', 'Run not found.');
    if (await this.repo.moveRun(run.id, ['AWAITING_APPROVAL', 'QUEUED'], 'CANCELLED', { finished: true })) {
      await this.audit.execute({ actorId: actor.id, action: 'AIV_RUN_CANCELLED', entity: 'aiv_run', entityId: run.id, newState: { before: run.status } });
    } else if (run.status === 'RUNNING') {
      await this.repo.requestCancel(run.id); // the worker stops before its next call
      await this.audit.execute({ actorId: actor.id, action: 'AIV_RUN_CANCEL_REQUESTED', entity: 'aiv_run', entityId: run.id, newState: {} });
    } else {
      return fail('CONFLICT', `A ${run.status.toLowerCase()} run cannot be cancelled.`);
    }
    return ok((await this.repo.getRunById(run.id)) as AivRun);
  }

  /** Worker entry point. Safe to call twice: only a QUEUED run is claimed. */
  async execute(runId: string): Promise<{ status: string }> {
    if (!(await this.repo.moveRun(runId, ['QUEUED'], 'RUNNING', { started: true, phase: 'Asking providers' }))) return { status: 'NOT_CLAIMED' };
    const run = (await this.repo.getRunById(runId)) as AivRun;
    try {
      const project = (await this.repo.getProject(run.projectId)) as AivProject;
      const [configs, competitors, queries, spentAtStart] = await Promise.all([
        this.repo.listProviderConfigs(project.id),
        this.repo.listPinnedCompetitors(project.id),
        run.queryIds.length ? this.repo.getQueries(project.id, run.queryIds) : Promise.resolve([]),
        this.repo.spendToDate(project.id),
      ]);
      const tasks: Array<{ queryId: string | null; text: string; location: { country: string; city: string | null } | null }> = run.kind === 'RESEARCH'
        ? run.adhocQueries.map((t) => ({ queryId: null, text: t, location: { country: project.marketCountry, city: project.marketCity } }))
        : queries.map((q) => ({ queryId: q.id, text: q.text, location: { country: q.marketCountry ?? project.marketCountry, city: q.marketCity ?? project.marketCity } }));
      const ctx = {
        brand: { id: 'BRAND', name: project.brandName, aliases: project.brandAliases },
        ownDomains: project.domains,
        // Registry names are descriptive ("Oraimo Uganda"); answers say "Oraimo".
        competitors: competitors.map((c) => ({ id: c.id, name: c.name, aliases: [...c.aliases, ...competitorMentionAliases(c)], domains: c.domains })),
      };
      const counts = { succeeded: 0, failed: 0, skipped: 0 };
      let runSpent = 0;
      const policy = project.budget;

      // Providers run in parallel; each provider asks its queries sequentially
      // (one concurrent request per key keeps inside provider rate limits).
      await Promise.all(run.providers.map(async (pid) => {
        const cfg = configs.find((c) => c.provider === pid);
        const adapter = this.providers[pid];
        const secret = cfg ? await this.repo.getProviderCredential(project.id, pid) : null;
        for (const task of tasks) {
          const base = { runId: run.id, projectId: project.id, runKind: run.kind, queryId: task.queryId, queryText: task.text, provider: pid,
            requestedLocation: task.location ? [task.location.city, task.location.country].filter(Boolean).join(', ') : null,
            brandMentioned: null, ownCited: null, citations: [], brandMention: null, competitorMentions: [], answer: null };
          const skip = async (why: string) => {
            await this.repo.insertObservation({ ...base, status: 'SKIPPED', errorCode: 'SKIPPED', errorMessage: why });
            counts.skipped += 1;
          };
          if (!cfg || !secret || !this.cipher || !cfg.enabled) { await skip('Provider was disabled or lost its key after the run was planned.'); continue; }
          if (await this.repo.isCancelRequested(run.id)) { await skip('Run cancelled.'); continue; }
          if (!mayContinue(runSpent, cfg.estUsdPerCall, policy, { todayUsd: spentAtStart.todayUsd + runSpent, monthUsd: spentAtStart.monthUsd + runSpent, providerMonthUsd: {} })) {
            await skip('Stopped by the spend limit.'); continue;
          }
          const callCfg = { apiKey: this.cipher.decrypt(secret), model: cfg.model, webSearch: cfg.webSearch, timeoutMs: CALL_TIMEOUT_MS };
          const input = { query: task.text, location: adapter.appliesLocation ? task.location : null };
          let lastErr: ProviderCallError | Error | null = null;
          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
              const { raw, latencyMs } = await adapter.executeQuery(input, callCfg);
              const answer = adapter.normalize(raw, callCfg, latencyMs, input);
              // Cost: what the provider reported, else the configured per-call estimate (labelled as such).
              const providerReported = answer.costUsd !== null;
              const cost = answer.costUsd ?? cfg.estUsdPerCall;
              answer.costUsd = cost;
              answer.rawMetadata = { ...answer.rawMetadata, costBasis: providerReported ? 'PROVIDER_REPORTED' : 'ESTIMATE_PER_CALL', attempts: attempt };
              const ev = extractEvidence(answer, ctx);
              await this.repo.insertObservation({ ...base, status: 'SUCCEEDED', errorCode: null, errorMessage: null, answer,
                brandMentioned: ev.brandMentioned, ownCited: ev.ownCited, citations: ev.citations, brandMention: ev.brandMention, competitorMentions: ev.competitorMentions });
              runSpent += cost;
              counts.succeeded += 1;
              lastErr = null;
              break;
            } catch (e) {
              lastErr = e as Error;
              const pe = e instanceof ProviderCallError ? e : null;
              if (attempt < MAX_ATTEMPTS && pe && isRetryable(pe.status, pe.code)) { await this.sleep(backoffMs(attempt)); continue; }
              break;
            }
          }
          if (lastErr) {
            const pe = lastErr instanceof ProviderCallError ? lastErr : null;
            await this.repo.insertObservation({ ...base, status: 'FAILED', errorCode: pe ? `${pe.code}${pe.status ? `_${pe.status}` : ''}` : 'ERROR', errorMessage: lastErr.message.slice(0, 500) });
            counts.failed += 1;
            this.logger.warn({ runId: run.id, provider: pid, code: pe?.code, status: pe?.status }, 'aiv provider call failed');
          }
          await this.repo.updateRunProgress(run.id, { ...counts, actualUsd: runSpent, phase: `Asking providers (${counts.succeeded + counts.failed + counts.skipped}/${run.totalTasks})` });
        }
      }));

      const cancelled = await this.repo.isCancelRequested(run.id);
      const status = finalStatus({ total: run.totalTasks, ...counts, pending: 0 }, cancelled);
      await this.repo.moveRun(run.id, ['RUNNING'], status, { phase: 'Done', finished: true, error: status === 'FAILED' ? 'Every provider call failed; see the per-answer errors.' : null });
      await this.raiseAlerts(run, status, counts);
      await this.audit.execute({ actorId: null, action: 'AIV_RUN_FINISHED', entity: 'aiv_run', entityId: run.id, newState: { status, ...counts, actualUsd: runSpent, actorKind: 'SCHEDULER' } });
      this.logger.info({ runId: run.id, status, ...counts, actualUsd: runSpent }, 'aiv run finished');
      return { status };
    } catch (e) {
      await this.repo.moveRun(run.id, ['RUNNING'], 'FAILED', { error: (e as Error).message.slice(0, 500), finished: true, phase: 'Failed' });
      this.logger.error({ runId: run.id, err: (e as Error).message }, 'aiv run crashed');
      return { status: 'FAILED' };
    }
  }

  /**
   * Alerts worth a person's attention, and only those: a failed run, a run
   * where some calls failed, and our site losing citations it had last run.
   * Deduped while open, so a daily schedule does not repeat an open alert.
   */
  private async raiseAlerts(run: AivRun, status: string, counts: { succeeded: number; failed: number; skipped: number }) {
    if (!this.alerts || run.kind === 'RESEARCH') return;
    try {
      if (status === 'FAILED') {
        await this.alerts.raise({ severity: 'HIGH', kind: 'AIV_RUN_FAILED', message: `AI Search run ${run.id} failed: every provider call failed. Open the run to see each provider's error.`, dedupeKey: `AIV_RUN_FAILED:${run.projectId}` });
      } else if (counts.failed > 0) {
        await this.alerts.raise({ severity: 'INFO', kind: 'AIV_RUN_PARTIAL', message: `AI Search run ${run.id}: ${counts.failed} of ${run.totalTasks} provider calls failed; the other answers were recorded.`, dedupeKey: `AIV_RUN_PARTIAL:${run.projectId}` });
      }
      const lost = (await this.repo.latestPairs(run.projectId, null))
        .filter((p) => p.current.runId === run.id && p.previous?.ownCited === true && p.current.ownCited === false);
      if (lost.length > 0) {
        const qs = [...new Set(lost.map((p) => p.queryText))];
        await this.alerts.raise({ severity: 'HIGH', kind: 'AIV_CITATION_LOST', message: `Our site stopped being cited in ${lost.length} answer(s) since the previous run: ${qs.slice(0, 3).map((q) => `"${q}"`).join(', ')}${qs.length > 3 ? '…' : ''}.`, dedupeKey: `AIV_CITATION_LOST:${run.projectId}` });
      }
    } catch (e) {
      this.logger.warn({ runId: run.id, err: (e as Error).message }, 'aiv alert raise failed');
    }
  }

  /** Hourly tick: start the monitoring run of every project whose schedule is due. */
  async runSchedules(): Promise<{ started: number; refused: number }> {
    let started = 0, refused = 0;
    for (const p of await this.repo.dueScheduledProjects(this.now().toISOString())) {
      // Marked first, so a refused or failing project is not retried every hour.
      await this.repo.markScheduled(p.id);
      const r = await this.start({ id: p.schedule.setBy, kind: 'SCHEDULER' }, p.id, { kind: 'MONITOR' });
      // An identical run already requested this hour is not a new start (and costs nothing more).
      if (r.ok) { if (r.value.created) started += 1; }
      else {
        refused += 1;
        this.logger.warn({ projectId: p.id, code: r.code, reason: r.message }, 'aiv scheduled run not started');
        if (r.code === 'BUDGET' || r.code === 'NOT_CONFIGURED') {
          await this.alerts?.raise({ severity: 'INFO', kind: 'AIV_SCHEDULE_SKIPPED', message: `Scheduled AI Search run not started: ${r.message}`, dedupeKey: `AIV_SCHEDULE_SKIPPED:${p.id}` }).catch(() => undefined);
        }
      }
    }
    return { started, refused };
  }

  getRun(projectId: string, runId: string) { return this.repo.getRun(projectId, runId); }
  listRuns(projectId: string, limit: number, offset: number, kind?: AivRun['kind']) { return this.repo.listRuns(projectId, limit, offset, kind); }
}
