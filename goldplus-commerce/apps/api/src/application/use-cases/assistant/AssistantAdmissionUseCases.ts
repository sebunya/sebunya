import { appLogger } from '../../logging/appLogger';
import type { IAssistantConfigRepository, IAssistantCounterStore, IAssistantLedgerRepository, MonthTotals } from '../../ports/IAssistantRepository';
import {
  DEFAULT_ASSISTANT_CONFIG,
  alarmsCrossed,
  costMicroUsd,
  decideAdmission,
  monthKey,
  reservationMicroUsd,
  sanitizeAssistantConfig,
  type AdmissionResult,
  type AssistantConfig,
  type Usage,
} from '../../../domain/assistant/AssistantPolicy';

/** A reservation left RESERVED this long is treated as UNKNOWN: still counted, never released by itself. */
const STALE_RESERVATION_MS = 10 * 60_000;

export interface AdmitInput {
  /** One-way, purpose-scoped pseudonym of the visitor (never a raw cookie, user id or address). */
  principalHash: string;
  /** Coarse network pseudonym for flood detection; CGNAT-safe because its ceiling is high and it never blocks alone. */
  addressHash: string | null;
  wantsAi: boolean;
  conversationId: string | null;
  /** The browser's per-send id: a retry reuses it and must be answered once across every replica. */
  requestId?: string | null;
  /** A reply to the shop's own clarifying question inside one unresolved request (mandate §5A.A): not a new meaningful request. */
  continuation?: boolean;
}

export interface AdmitOutput extends AdmissionResult {
  reservationId: string | null;
  model: string;
  effort: 'low' | 'medium';
  maxOutputTokens: number;
  maxToolRounds: number;
  /** True when the counter store was unreachable and a stricter local fallback decided. */
  degraded: boolean;
}

export class AssistantAdmissionUseCases {
  constructor(
    private readonly ledger: IAssistantLedgerRepository,
    private readonly configRepo: IAssistantConfigRepository,
    private readonly counters: IAssistantCounterStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async config(): Promise<{ config: AssistantConfig; version: number }> {
    try {
      const stored = await this.configRepo.get();
      return { config: sanitizeAssistantConfig(stored?.config), version: stored?.version ?? 0 };
    } catch (err) {
      appLogger.error({ err: err instanceof Error ? err.message : String(err) }, '[assistant] config unreadable; defaults with paid layer OFF');
      // Fail closed for money: without a readable config the paid layer stays off.
      return { config: { ...DEFAULT_ASSISTANT_CONFIG, aiEnabled: false }, version: 0 };
    }
  }

  async saveConfig(raw: unknown, expectedVersion: number, actorId: string): Promise<{ version: number } | null> {
    return this.configRepo.save(sanitizeAssistantConfig(raw), expectedVersion, actorId);
  }

  /**
   * One call per customer turn. Counts the request, applies the fairness tiers
   * and abuse ceilings, and (for a paid turn) reserves the worst-case cost in
   * the month ledger. No paid model call may be made without a reservation id.
   */
  async admit(input: AdmitInput): Promise<AdmitOutput> {
    const { config } = await this.config();
    const base = { model: config.model, effort: config.effort, maxOutputTokens: config.maxOutputTokens, maxToolRounds: config.maxToolRounds };
    const minute = { limit: Number.MAX_SAFE_INTEGER, windowMs: 60_000 };
    let degraded = false;
    const count = async (control: string, identity: string, windowMs: number) => {
      const r = await this.counters.consume(control, identity, { limit: Number.MAX_SAFE_INTEGER, windowMs });
      degraded = degraded || r.degraded;
      return r.count;
    };

    // A retried send (same request id) is answered once across replicas: the second arrival is refused before it is counted.
    if (input.requestId) {
      const seen = await count('assistant.request', input.requestId, 2 * 60_000);
      if (seen > 1) return { ...base, decision: 'DUPLICATE', tier: 'welcome', reason: 'request id already admitted', reservationId: null, degraded };
    }
    // Abuse ceilings first: cheap, every request, before anything is reserved.
    const burstInMinute = await count('assistant.burst', input.principalHash, minute.windowMs);
    const addressInMinute = input.addressHash ? await count('assistant.address', input.addressHash, minute.windowMs) : 0;
    // Fairness: the meaningful-request count decides the tier (welcome ≤ free, progressive after).
    // A clarification reply stays inside the request it answers: it is read, not counted. Only deterministic
    // turns qualify (the caller decides), so a forged flag can never buy a paid answer.
    const meaningfulInWindow = input.continuation && !input.wantsAi
      ? await this.counters.consume('assistant.meaningful', input.principalHash, { limit: Number.MAX_SAFE_INTEGER, windowMs: config.fairnessWindowHours * 3_600_000 }).then((r) => { degraded = degraded || r.degraded; return Math.max(0, r.count - 1); })
      : await count('assistant.meaningful', input.principalHash, config.fairnessWindowHours * 3_600_000);
    const tierProgressive = meaningfulInWindow > config.freeRequests;

    let paidInHour = 0, paidInDay = 0, paidInPacingWindow = 0;
    if (input.wantsAi && config.enabled && config.aiEnabled && tierProgressive) {
      // Only a progressive-tier paid attempt draws on the silent allowances.
      paidInHour = await count('assistant.paid.hour', input.principalHash, 3_600_000);
      paidInDay = await count('assistant.paid.day', input.principalHash, 24 * 3_600_000);
      paidInPacingWindow = await count('assistant.paid.pace', input.principalHash, config.pacingSeconds * 1000);
    }

    const month = monthKey(this.now());
    let totals: MonthTotals;
    try {
      totals = await this.ledger.totals(month);
    } catch (err) {
      appLogger.error({ err: err instanceof Error ? err.message : String(err) }, '[assistant] ledger unreadable; paid layer refused');
      return { ...base, decision: 'GLOBAL_BUDGET_FALLBACK', tier: tierProgressive ? 'progressive' : 'welcome', reason: 'ledger unavailable', reservationId: null, degraded };
    }

    const result = decideAdmission(config, input.wantsAi, {
      meaningfulInWindow, burstInMinute, addressInMinute, paidInHour, paidInDay, paidInPacingWindow,
      settledMicroUsd: totals.settledMicroUsd, reservedMicroUsd: totals.reservedMicroUsd,
    });
    if (result.decision !== 'ALLOW_AI') return { ...base, ...result, reservationId: null, degraded };

    // The pure decision said yes; the ledger has the last word, atomically.
    let reserved: { id: string } | null = null;
    try {
      reserved = await this.ledger.reserve({
        month, amountMicroUsd: reservationMicroUsd(config), killThresholdMicroUsd: config.killThresholdMicroUsd,
        model: config.model, principalHash: input.principalHash, conversationId: input.conversationId, staleAfterMs: STALE_RESERVATION_MS,
      });
    } catch (err) {
      appLogger.error({ err: err instanceof Error ? err.message : String(err) }, '[assistant] reservation failed; paid layer refused');
    }
    if (!reserved) return { ...base, decision: 'GLOBAL_BUDGET_FALLBACK', tier: result.tier, reason: 'month kill threshold reached at reservation', reservationId: null, degraded };
    return { ...base, ...result, reservationId: reserved.id, degraded };
  }

  /** Provider-reported usage replaces the reservation; alarms fire once per threshold crossing. */
  async settle(input: { reservationId: string; usage: Usage; providerRequestId: string | null; outcome: string; model: string }): Promise<{ costMicroUsd: number } | null> {
    const { config } = await this.config();
    const cost = costMicroUsd(input.usage, input.model);
    const row = await this.ledger.settle({ id: input.reservationId, usage: input.usage, costMicroUsd: cost, providerRequestId: input.providerRequestId, outcome: input.outcome });
    if (!row) return null;
    const crossed = alarmsCrossed(row.settledAfter - cost, row.settledAfter, config.alarmThresholdsMicroUsd);
    for (const t of crossed) appLogger.warn({ thresholdMicroUsd: t, settledMicroUsd: row.settledAfter, capMicroUsd: config.monthlyCapMicroUsd }, '[assistant] month spend alarm threshold crossed');
    if (row.settledAfter >= config.killThresholdMicroUsd) appLogger.error({ settledMicroUsd: row.settledAfter }, '[assistant] month kill threshold reached: paid layer now refuses');
    return { costMicroUsd: cost };
  }

  /** Only for a call the provider certainly did not bill (an error before any output). Ambiguous outcomes stay reserved. */
  async release(input: { reservationId: string; reason: string }): Promise<boolean> {
    return this.ledger.release({ id: input.reservationId, reason: input.reason });
  }

  async status(): Promise<{ month: string; config: AssistantConfig; version: number; totals: MonthTotals; recent: Array<{ status: string; model: string; reservedMicroUsd: number; settledMicroUsd: number | null; outcome: string | null; createdAt: string }> }> {
    const month = monthKey(this.now());
    const [{ config, version }, totals, recent] = await Promise.all([this.config(), this.ledger.totals(month), this.ledger.recent(month, 25)]);
    return {
      month, config, version, totals,
      recent: recent.map((r) => ({ status: r.status, model: r.model, reservedMicroUsd: r.reservedMicroUsd, settledMicroUsd: r.settledMicroUsd, outcome: r.outcome, createdAt: r.createdAt.toISOString() })),
    };
  }
}
