import { ProviderCallError, type AiAnswerProvider, type AiVisibilityRepository, type AivProject, type AivRun, type AlertSink, type CredentialCipher, type RunQueue } from '../../ports/AiVisibility';
import type { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import type { ILogger } from '../../ports/ILogger';
import type { ProviderId } from '../../../domain/ai-visibility/Evidence';
import { extractEvidence } from '../../../domain/ai-visibility/Evidence';
import { buildEvidenceContext } from './EvidenceContext';
import { evaluateRunBudget, mayContinue } from '../../../domain/ai-visibility/Budget';
import { backoffMs, finalStatus, isRetryable } from '../../../domain/ai-visibility/RunLifecycle';
import { fail, isProvider, ok, type Actor, type Result } from './AiVisibilitySetupUseCases';

const MAX_ATTEMPTS = 3;
const CALL_TIMEOUT_MS = 90_000;
const MAX_ADHOC = 20;
/** Largest provider reply kept verbatim for re-parsing (~300 KB). */
const RAW_MAX_CHARS = 300_000;

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
      // Fixed now: raising the threshold later must not let the requester approve their own run.
      overThreshold: decision.requiresApproval,
    });
    await this.audit.execute({ actorId: actor.id, action: 'AIV_RUN_REQUESTED', entity: 'aiv_run', entityId: run.id, newState: { kind, providers, queryCount, estimatedUsd: decision.estimatedUsd, status: run.status, actorKind: actor.kind } });
    if (!needsApproval) await this.dispatch(run);
    return ok({ run: (await this.repo.getRunById(run.id)) ?? run, created: true });
  }

  private async dispatch(run: AivRun) {
    // A throwing queue (Redis down) must not leave a QUEUED run that blocks the project.
    const queued = await this.queue.enqueueRun(run.id).catch((e: Error) => { this.logger.error({ runId: run.id, err: e.message }, 'aiv enqueue failed'); return false; });
    if (!queued) await this.repo.moveRun(run.id, ['QUEUED'], 'FAILED', { error: 'The background queue is unavailable; the run was not started.', finished: true });
  }

  async approve(actor: Actor, projectId: string, runId: string): Promise<Result<AivRun>> {
    const run = await this.repo.getRun(projectId, runId);
    if (!run) return fail('NOT_FOUND', 'Run not found.');
    if (actor.kind !== 'USER') return fail('FORBIDDEN', 'Only a person can approve a run that spends provider budget.');
    const project = (await this.repo.getProject(projectId)) as AivProject;
    // Four eyes is about the PERSON, whatever kind the request declared: a user
    // could send X-Actor-Kind: AGENT and then approve their own run. Over the
    // spend threshold, the requester (or the person whose schedule asked) never
    // approves. Under it, a machine-origin run only needs a human confirmation,
    // which that same person may give.
    // Decided when the run was requested (stored on the run), never from today's threshold.
    if (run.overThreshold && run.requestedBy && run.requestedBy === actor.id) return fail('FORBIDDEN', 'Someone other than the requester must approve a run over the approval threshold.');
    // Budget is re-checked at approval time: spend may have moved since the request.
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
    // Only QUEUED is claimed. A stalled-job redelivery of a RUNNING run is not
    // resumed: the stale reaper ends it after 20 minutes without a heartbeat,
    // which frees the project for the next run (answers already stored stay).
    if (!(await this.repo.moveRun(runId, ['QUEUED'], 'RUNNING', { started: true, phase: 'Asking providers' }))) return { status: 'NOT_CLAIMED' };
    const run = (await this.repo.getRunById(runId)) as AivRun;
    try {
      const project = (await this.repo.getProject(run.projectId)) as AivProject;
      const [configs, queries] = await Promise.all([
        this.repo.listProviderConfigs(project.id),
        run.queryIds.length ? this.repo.getQueries(project.id, run.queryIds) : Promise.resolve([]),
      ]);
      const tasks: Array<{ queryId: string | null; text: string; location: { country: string; city: string | null } | null }> = run.kind === 'RESEARCH'
        ? run.adhocQueries.map((t) => ({ queryId: null, text: t, location: { country: project.marketCountry, city: project.marketCity } }))
        : queries.map((q) => ({ queryId: q.id, text: q.text, location: { country: q.marketCountry ?? project.marketCountry, city: q.marketCity ?? project.marketCity } }));
      const counts = { succeeded: 0, failed: 0, skipped: 0 };
      let runSpent = 0;
      const policy = project.budget;

      // Providers run in parallel; each provider asks its queries sequentially
      // (one concurrent request per key keeps inside provider rate limits).
      await Promise.all(run.providers.map(async (pid) => {
        const cfg = configs.find((c) => c.provider === pid);
        const adapter = this.providers[pid];
        const secret = cfg ? await this.repo.getProviderCredential(project.id, pid) : null;
        // An authorisation failure (bad, revoked or unpaid key) fails every
        // question the same way; after the first one the provider is not asked
        // again this run, and Settings shows why.
        let providerStop: string | null = null;
        for (const task of tasks) {
          const base = { runId: run.id, projectId: project.id, runKind: run.kind, queryId: task.queryId, queryText: task.text, provider: pid,
            requestedLocation: task.location ? [task.location.city, task.location.country].filter(Boolean).join(', ') : null,
            brandMentioned: null, ownCited: null, citations: [], brandMention: null, competitorMentions: [], answer: null };
          const skip = async (why: string) => {
            await this.repo.insertObservation({ ...base, status: 'SKIPPED', errorCode: 'SKIPPED', errorMessage: why });
            counts.skipped += 1;
          };
          if (!cfg || !secret || !this.cipher || !cfg.enabled) { await skip('Provider was disabled or lost its key after the run was planned.'); continue; }
          if (providerStop) { await skip(providerStop); continue; }
          const stop = await this.repo.runStopReason(run.id);
          if (stop === 'ENDED') return; // marked failed/stale elsewhere: write nothing more
          if (stop === 'CANCELLED') { await skip('Run cancelled.'); continue; }
          // Spend is re-read before EVERY call: recorded costs include this run's
          // answers so far and any other run spending at the same time (a
          // monitoring and a research run together). A snapshot taken at the
          // start let two concurrent runs each stay "within" the daily limit.
          const live = await this.repo.spendToDate(project.id);
          const providerCap = cfg.monthlyCapUsd;
          if (!mayContinue(runSpent, cfg.estUsdPerCall, policy, live)
            || (providerCap != null && (live.providerMonthUsd[pid] ?? 0) + cfg.estUsdPerCall > providerCap)) {
            await skip('Stopped by the spend limit.'); continue;
          }
          const callCfg = { apiKey: this.cipher.decrypt(secret), model: cfg.model, webSearch: cfg.webSearch, timeoutMs: CALL_TIMEOUT_MS };
          const input = { query: task.text, location: adapter.appliesLocation ? task.location : null };
          let lastErr: ProviderCallError | Error | null = null;
          // Attempts that failed AFTER the provider may have done the work
          // (timeouts, 5xx) can still be billed; each counts at the estimate so
          // the spend limits err towards stopping, never towards overspending.
          let possiblyBilled = 0;
          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
              const { raw, latencyMs } = await adapter.executeQuery(input, callCfg);
              const answer = adapter.normalize(raw, callCfg, latencyMs, input);
              // Cost: what the provider reported, else the configured per-call estimate (labelled as such).
              // The provider's reply itself is the evidence: kept (bounded) so a
              // parser fixed later can re-read every past answer (see reclassify).
              const rawSize = JSON.stringify(raw ?? null).length;
              answer.rawMetadata = { ...answer.rawMetadata, ...(rawSize <= RAW_MAX_CHARS ? { rawResponse: raw } : { rawResponseOmitted: `reply was ${rawSize} characters (limit ${RAW_MAX_CHARS})` }), parsedWith: pid, requestedModel: cfg.model };
              const providerReported = answer.costUsd !== null;
              const cost = (answer.costUsd ?? cfg.estUsdPerCall) + possiblyBilled * cfg.estUsdPerCall;
              answer.costUsd = cost;
              answer.rawMetadata = { ...answer.rawMetadata, costBasis: providerReported && possiblyBilled === 0 ? 'PROVIDER_REPORTED' : 'ESTIMATE_PER_CALL', attempts: attempt, possiblyBilledRetries: possiblyBilled };
              // Classified with the rules as they are NOW, not as they were when the
              // run started: a domain or pin change mid-run (which re-classifies
              // stored answers) must not leave this run's answers on the old rules.
              const liveProject = (await this.repo.getProject(project.id)) ?? project;
              const ev = extractEvidence(answer, buildEvidenceContext(liveProject, await this.repo.listPinnedCompetitors(project.id)));
              await this.repo.insertObservation({ ...base, status: 'SUCCEEDED', errorCode: null, errorMessage: null, answer,
                brandMentioned: ev.brandMentioned, ownCited: ev.ownCited, citations: ev.citations, brandMention: ev.brandMention, competitorMentions: ev.competitorMentions });
              runSpent += cost;
              counts.succeeded += 1;
              lastErr = null;
              break;
            } catch (e) {
              lastErr = e as Error;
              const pe = e instanceof ProviderCallError ? e : null;
              // Timeouts, 5xx and errors reported inside a 200 reply (Anthropic's
              // web_search_tool_result error) happened after work was done.
              if (pe && (pe.code === 'TIMEOUT' || (pe.status != null && (pe.status >= 500 || pe.status === 200)))) possiblyBilled += 1;
              if (attempt < MAX_ATTEMPTS && pe && isRetryable(pe.status, pe.code)) { await this.sleep(backoffMs(attempt)); continue; }
              break;
            }
          }
          if (lastErr) {
            const pe = lastErr instanceof ProviderCallError ? lastErr : null;
            const failedCost = possiblyBilled * cfg.estUsdPerCall;
            await this.repo.insertObservation({ ...base, status: 'FAILED', errorCode: pe ? `${pe.code}${pe.status ? `_${pe.status}` : ''}` : 'ERROR', errorMessage: lastErr.message.slice(0, 500), costUsd: failedCost > 0 ? failedCost : null });
            runSpent += failedCost;
            counts.failed += 1;
            this.logger.warn({ runId: run.id, provider: pid, code: pe?.code, status: pe?.status }, 'aiv provider call failed');
            if (pe && pe.status != null && [401, 402, 403].includes(pe.status)) {
              providerStop = `Not asked: the provider refused the key earlier in this run (HTTP ${pe.status}).`;
              await this.repo.recordProviderHealth(project.id, pid, 'FAILED', `Refused during run ${run.id}: ${lastErr.message}`.slice(0, 500));
            }
          }
          await this.repo.updateRunProgress(run.id, { ...counts, actualUsd: runSpent, phase: `Asking providers (${counts.succeeded + counts.failed + counts.skipped}/${run.totalTasks})` });
        }
      }));

      // Final counts, including skips (skip paths do not write progress).
      await this.repo.updateRunProgress(run.id, { ...counts, actualUsd: runSpent, phase: 'Finishing' });
      const cancelled = await this.repo.isCancelRequested(run.id);
      const status = finalStatus({ total: run.totalTasks, ...counts, pending: 0 }, cancelled);
      const moved = await this.repo.moveRun(run.id, ['RUNNING'], status, { phase: 'Done', finished: true, error: status === 'FAILED' ? 'Every provider call failed; see the per-answer errors.' : null });
      if (!moved) {
        // Ended elsewhere (cancelled, or marked stale): record what actually happened, not a status the database does not hold.
        await this.audit.execute({ actorId: null, action: 'AIV_RUN_WORKER_STOPPED', entity: 'aiv_run', entityId: run.id, newState: { wouldHaveBeen: status, ...counts, actualUsd: runSpent, actorKind: 'SCHEDULER' } });
        return { status: 'ENDED_ELSEWHERE' };
      }
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
      // Close what no longer holds: a clean run ends "failed"/"partial" alerts.
      if (status === 'COMPLETED' || status === 'PARTIAL') await this.alerts.clear(`AIV_RUN_FAILED:${run.projectId}`);
      if (status === 'COMPLETED') await this.alerts.clear(`AIV_RUN_PARTIAL:${run.projectId}`);
      const pairs = await this.repo.latestPairs(run.projectId, null);
      const lost = pairs.filter((p) => p.current.runId === run.id && p.previous?.ownCited === true && p.current.ownCited === false);
      // No question currently in a lost state (latest answer uncited after a cited one) -> the alert is over.
      const stillLost = pairs.some((p) => p.previous?.ownCited === true && p.current.ownCited === false);
      if (!stillLost) await this.alerts.clear(`AIV_CITATION_LOST:${run.projectId}`);
      if (lost.length > 0) {
        const qs = [...new Set(lost.map((p) => p.queryText))];
        await this.alerts.raise({ severity: 'HIGH', kind: 'AIV_CITATION_LOST', message: `Our site stopped being cited in ${lost.length} answer(s) since the previous run: ${qs.slice(0, 3).map((q) => `"${q}"`).join(', ')}${qs.length > 3 ? '…' : ''}.`, dedupeKey: `AIV_CITATION_LOST:${run.projectId}` });
      }
    } catch (e) {
      this.logger.warn({ runId: run.id, err: (e as Error).message }, 'aiv alert raise failed');
    }
  }

  /**
   * Ends runs nobody moved, so one forgotten request never blocks a project:
   * AWAITING_APPROVAL for a day (nobody else was there to approve it) and
   * QUEUED for six hours (the queue lost it). Each is audited and alerted.
   */
  async expireUnattended(): Promise<number> {
    // QUEUED: 6 hours, not 1 — runs of several projects and re-classification
    // share one queue, and a long run ahead can legitimately keep one waiting.
    const ended = await this.repo.expireUnattendedRuns(24, 360);
    for (const r of ended) {
      await this.audit.execute({ actorId: null, action: 'AIV_RUN_EXPIRED', entity: 'aiv_run', entityId: r.id, newState: { from: r.from, actorKind: 'SCHEDULER' } });
      await this.alerts?.raise({ severity: 'INFO', kind: 'AIV_RUN_EXPIRED', message: r.from === 'AWAITING_APPROVAL'
        ? `AI Search run ${r.id} waited 24 hours for approval and was closed. Over the approval threshold a second person must approve; lower the estimate or raise the threshold if you work alone.`
        : `AI Search run ${r.id} was queued for six hours without starting and was closed; the background queue may be down.`, dedupeKey: `AIV_RUN_EXPIRED:${r.projectId}` }).catch(() => undefined);
    }
    return ended.length;
  }

  /** Hourly tick: start the monitoring run of every project whose schedule is due. */
  async runSchedules(): Promise<{ started: number; refused: number }> {
    let started = 0, refused = 0;
    for (const p of await this.repo.dueScheduledProjects(this.now().toISOString())) {
      // Marked first, so a refused or failing project is not retried every hour.
      await this.repo.markScheduled(p.id);
      const r = await this.start({ id: p.schedule.setBy, kind: 'SCHEDULER' }, p.id, { kind: 'MONITOR' });
      // An identical run already requested this hour is not a new start (and costs nothing more).
      if (r.ok) { if (r.value.created) started += 1; await this.alerts?.clear(`AIV_SCHEDULE_SKIPPED:${p.id}`).catch(() => undefined); }
      else {
        refused += 1;
        this.logger.warn({ projectId: p.id, code: r.code, reason: r.message }, 'aiv scheduled run not started');
        if (r.code === 'BUDGET' || r.code === 'NOT_CONFIGURED' || r.code === 'CONFLICT') {
          await this.alerts?.raise({ severity: 'INFO', kind: 'AIV_SCHEDULE_SKIPPED', message: `Scheduled AI Search run not started: ${r.message}`, dedupeKey: `AIV_SCHEDULE_SKIPPED:${p.id}` }).catch(() => undefined);
        }
      }
    }
    return { started, refused };
  }

  getRun(projectId: string, runId: string) { return this.repo.getRun(projectId, runId); }
  findByKey(projectId: string, key: string) { return this.repo.findRunByIdempotencyKey(projectId, key); }
  listRuns(projectId: string, limit: number, offset: number, kind?: AivRun['kind']) { return this.repo.listRuns(projectId, limit, offset, kind); }
}
