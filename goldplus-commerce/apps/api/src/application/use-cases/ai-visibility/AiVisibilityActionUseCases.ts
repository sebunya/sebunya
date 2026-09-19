import type { AiVisibilityRepository, AivAction, AivRun } from '../../ports/AiVisibility';
import type { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { canMove, mayApprove, mayExecute, RISK_OF, verificationVerdict, type ActionCategory, type ActionStatus } from '../../../domain/ai-visibility/Actions';
import { fail, ok, type Actor, type Result } from './AiVisibilitySetupUseCases';
import type { AiVisibilityRunUseCases } from './AiVisibilityRunUseCases';

const CATEGORIES = Object.keys(RISK_OF) as ActionCategory[];
const DEFAULT_WINDOW_DAYS = 14;

/**
 * Action Center. OBSERVE -> DIAGNOSE -> RECOMMEND -> APPROVE -> ACT -> VERIFY.
 * Every transition is a compare-and-set with a history event and an audit row.
 * Agents propose; people approve; publishing is carried out by people.
 * Verification is before/after on the action's own queries and says so.
 */
export class AiVisibilityActionUseCases {
  constructor(
    private readonly repo: AiVisibilityRepository,
    private readonly audit: CreateAuditLogUseCase,
    private readonly runs: AiVisibilityRunUseCases,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async trail(actor: Actor, a: AivAction, action: string, extra: Record<string, unknown> = {}) {
    await this.audit.execute({ actorId: actor.id, action, entity: 'aiv_action', entityId: a.id, newState: { title: a.title, category: a.category, risk: a.risk, actorKind: actor.kind, ...extra } });
  }

  /** Citation state of the action's queries across the latest answers, optionally after a time. */
  private async citationState(projectId: string, queryIds: string[], afterIso: string | null) {
    let cited = 0, eligible = 0; const observationIds: string[] = [];
    for (const qid of queryIds) {
      const page = await this.repo.listObservations(projectId, { queryId: qid, status: 'SUCCEEDED', fromIso: afterIso ?? undefined, limit: 20, offset: 0 });
      // latest per provider
      const seen = new Set<string>();
      for (const o of page.rows) {
        if (o.runKind === 'RESEARCH' || seen.has(o.provider)) continue;
        seen.add(o.provider);
        if (o.ownCited === null) continue;
        eligible += 1; if (o.ownCited) cited += 1; observationIds.push(o.id);
      }
    }
    return { cited, eligible, observationIds, measuredAt: this.now().toISOString() };
  }

  async propose(actor: Actor, projectId: string, body: Record<string, unknown>): Promise<Result<AivAction>> {
    if (!(await this.repo.getProject(projectId))) return fail('NOT_FOUND', 'Project not found.');
    const category = String(body.category ?? '') as ActionCategory;
    if (!CATEGORIES.includes(category)) return fail('BAD_INPUT', `category must be one of ${CATEGORIES.join(', ')}.`);
    const title = String(body.title ?? '').trim();
    const reason = String(body.reason ?? body.why ?? '').trim();
    if (title.length < 5 || reason.length < 10) return fail('BAD_INPUT', 'An action needs a title and a reason that says why (with evidence).');
    const evidence = (body.evidence && typeof body.evidence === 'object' ? body.evidence : {}) as Record<string, unknown>;
    // The queries the action targets: explicit, else the query its evidence names.
    const queryIds = Array.isArray(body.queryIds) ? body.queryIds.map(String).slice(0, 50)
      : typeof evidence.queryId === 'string' ? [evidence.queryId] : [];
    const a = await this.repo.createAction({
      projectId, category, risk: RISK_OF[category], status: 'DRAFT', title: title.slice(0, 200), reason: reason.slice(0, 2000),
      mechanism: body.mechanism ? String(body.mechanism).slice(0, 2000) : null, plan: body.plan ? String(body.plan).slice(0, 10_000) : null,
      targetPage: body.targetPage ? String(body.targetPage).slice(0, 500) : null, expectedImpact: body.expectedImpact ? String(body.expectedImpact).slice(0, 1000) : null,
      limitations: body.limitations ? String(body.limitations).slice(0, 2000) : null, confidence: body.confidence ? String(body.confidence).slice(0, 20) : null,
      evidence, queryIds, baseline: null, rollback: body.rollback ? String(body.rollback).slice(0, 2000) : null,
      proposedBy: actor.id, proposerKind: actor.kind, verifyAfter: null,
    });
    await this.trail(actor, a, 'AIV_ACTION_PROPOSED', { evidence });
    return ok(a);
  }

  private async move(actor: Actor, projectId: string, id: string, to: ActionStatus, note: string | null, patch: Parameters<AiVisibilityRepository['moveAction']>[5] = {}): Promise<Result<AivAction>> {
    const a = await this.repo.getAction(projectId, id);
    if (!a) return fail('NOT_FOUND', 'Action not found.');
    if (!canMove(a.status, to)) return fail('CONFLICT', `An action that is ${a.status} cannot become ${to}.`);
    if (!(await this.repo.moveAction(a.id, a.status, to, actor, note, patch))) return fail('CONFLICT', 'The action changed while you were acting on it; reload and try again.');
    await this.trail(actor, a, `AIV_ACTION_${to}`, { from: a.status, note });
    return ok((await this.repo.getAction(projectId, id)) as AivAction);
  }

  submit(actor: Actor, projectId: string, id: string) { return this.move(actor, projectId, id, 'AWAITING_APPROVAL', 'Submitted for approval'); }
  cancel(actor: Actor, projectId: string, id: string, note: string | null) { return this.move(actor, projectId, id, 'CANCELLED', note); }

  async approve(actor: Actor, projectId: string, id: string, note: string | null): Promise<Result<AivAction>> {
    const a = await this.repo.getAction(projectId, id);
    if (!a) return fail('NOT_FOUND', 'Action not found.');
    // The proposer is the PERSON behind the proposal, whatever kind it declared
    // (an agent working on someone's login is that someone for four eyes).
    const d = mayApprove({ approverKind: actor.kind, approverId: actor.id ?? '', proposerId: a.proposedBy, status: a.status });
    if (!d.ok) return fail('FORBIDDEN', d.reason);
    // The baseline is frozen at approval: what verification compares against.
    const baseline = a.queryIds.length ? await this.citationState(projectId, a.queryIds, null) : null;
    return this.move(actor, projectId, id, 'APPROVED', note, { approvedBy: actor.id ?? undefined, approvedAt: this.now().toISOString(), baseline: baseline as unknown as Record<string, unknown> });
  }

  reject(actor: Actor, projectId: string, id: string, note: string | null) {
    if (actor.kind !== 'USER') return Promise.resolve(fail<AivAction>('FORBIDDEN', 'Only a person can reject an action.'));
    return this.move(actor, projectId, id, 'REJECTED', note);
  }

  /**
   * Record that an approved action was carried out. MEASUREMENT_RUN actions
   * start their run here (still subject to the run's own budget gate); every
   * other category is performed by a person or a reviewed change, and this
   * records the result, then opens the verification window.
   */
  async execute(actor: Actor, projectId: string, id: string, body: Record<string, unknown>): Promise<Result<AivAction>> {
    const a = await this.repo.getAction(projectId, id);
    if (!a) return fail('NOT_FOUND', 'Action not found.');
    const d = mayExecute({ status: a.status, risk: a.risk, actorKind: actor.kind });
    if (!d.ok) return fail('FORBIDDEN', d.reason);
    let result = String(body.result ?? '').trim();
    if (a.category === 'MEASUREMENT_RUN') {
      // Spending is the RUN permission's; the route for this path requires it
      // (executeMeasurement). Here, only a NEW run that is actually going
      // counts as done — an existing identical run, or one still waiting for
      // approval, is not this action's measurement.
      if (!body.__runPermission) return fail('FORBIDDEN', 'Starting a measurement run needs the AI Search run permission; use the "Start the run" button.');
      // One key per attempt: the action's latest run decides what pressing the
      // button again does. Waiting for approval -> say so; approved/going/done
      // -> that run IS the measurement (complete the action); rejected,
      // cancelled or failed -> a fresh attempt with a new key.
      let attempt = 1;
      let prior: AivRun | null = null;
      for (; attempt <= 50; attempt++) {
        const found = await this.runs.findByKey(projectId, attempt === 1 ? `action:${a.id}` : `action:${a.id}:${attempt}`);
        if (!found) break;
        prior = found;
      }
      let runRef = prior;
      if (prior && prior.status === 'AWAITING_APPROVAL') return fail('CONFLICT', `Run ${prior.id} is waiting for approval (over the spend threshold). Once someone else approves it under Runs, press "Start the run" again to record it here.`);
      if (!prior || ['REJECTED', 'CANCELLED', 'FAILED'].includes(prior.status)) {
        const r = await this.runs.start(actor, projectId, { kind: 'MONITOR', queryIds: a.queryIds.length ? a.queryIds : undefined, actionId: a.id, idempotencyKey: attempt === 1 ? `action:${a.id}` : `action:${a.id}:${attempt}` });
        if (!r.ok) return r as Result<AivAction>;
        if (r.value.run.status === 'AWAITING_APPROVAL') return fail('CONFLICT', `Run ${r.value.run.id} is waiting for approval (over the spend threshold). Once someone else approves it under Runs, press "Start the run" again to record it here.`);
        runRef = r.value.run;
      }
      result = `Run ${runRef!.id} ${runRef!.status.toLowerCase().replace('_', ' ')}.`;
    } else if (result.length < 5) {
      return fail('BAD_INPUT', 'Say what was done (and where), so the history is useful.');
    }
    const days = Math.min(Math.max(Number(body.verifyAfterDays ?? DEFAULT_WINDOW_DAYS) || DEFAULT_WINDOW_DAYS, 1), 90);
    const done = await this.move(actor, projectId, id, 'COMPLETED', result, { executedBy: actor.id ?? undefined, executedAt: this.now().toISOString(), result, rollback: body.rollback ? String(body.rollback) : a.rollback ?? undefined });
    if (!done.ok || a.queryIds.length === 0) return done;
    return this.move(actor, projectId, id, 'VERIFICATION_PENDING', `Measure again after ${days} days`, { verifyAfter: new Date(this.now().getTime() + days * 86_400_000).toISOString() });
  }

  /** Before/after on the action's queries, using only answers recorded after the change. */
  async verify(actor: Actor, projectId: string, id: string): Promise<Result<AivAction>> {
    const a = await this.repo.getAction(projectId, id);
    if (!a) return fail('NOT_FOUND', 'Action not found.');
    if (a.status !== 'VERIFICATION_PENDING') return fail('CONFLICT', `Only an action pending verification can be verified (this one is ${a.status}).`);
    if (a.verifyAfter && this.now() < new Date(a.verifyAfter)) return fail('CONFLICT', `The measurement window ends ${a.verifyAfter.slice(0, 10)}; measuring earlier would mostly measure noise.`);
    const after = await this.citationState(projectId, a.queryIds, a.executedAt);
    if (after.eligible === 0) return fail('BAD_INPUT', 'No answers have been recorded for these questions since the change. Run a check first.');
    const base = (a.baseline ?? { cited: 0, eligible: 0 }) as { cited: number; eligible: number };
    const v = verificationVerdict(base, after);
    return this.move(actor, projectId, id, v.status, v.summary, { verification: { ...v, baseline: base, after } as unknown as Record<string, unknown> });
  }

  list(projectId: string, status: string | null, limit: number, offset: number) { return this.repo.listActions(projectId, status, limit, offset); }

  async get(projectId: string, id: string): Promise<Result<AivAction & { events: unknown[] }>> {
    const a = await this.repo.getAction(projectId, id);
    if (!a) return fail('NOT_FOUND', 'Action not found.');
    return ok({ ...a, events: await this.repo.listActionEvents(a.id) });
  }
}
