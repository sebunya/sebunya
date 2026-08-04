import { ILoyaltyRepository } from '../../ports/ILoyaltyRepository';
import { ILoyaltyCompletionRepository } from '../../ports/ILoyaltyCompletion';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

type Fail = { ok: false; code: string; message: string };
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });

/**
 * Verification-linked earning (loyalty brief PART J — the differentiator).
 *
 * Points on a SCAN, attributed to a signed-in account, through the versioned
 * rule 'verification_scan' — INACTIVE until Rob activates it (PART V #7), so
 * the engine exists without a single point of unapproved liability. Anti-
 * gaming: one earn per code ever (idempotency `verify:<code>`), a per-day cap
 * from the rule row, and a fraud signal when scan volume outruns the cap.
 * Ledger shape: `adjustment` entries (positive, no order) — the CHECK
 * constraint reserves `earn` for order-backed points.
 */
export class EarnForVerificationScanUseCase {
  constructor(
    private readonly loyalty: ILoyaltyRepository,
    private readonly completion: ILoyaltyCompletionRepository,
  ) {}

  async execute(input: { userId: string; code: string; successful: boolean }): Promise<{ ok: true; points: number } | Fail> {
    const config = await this.completion.getProgrammeConfig();
    if (!config.enabled || config.killSwitch) return fail('PROGRAMME_DISABLED', 'Programme inactive.');
    const rule = await this.completion.getActiveRule('verification_scan');
    if (!rule) return fail('RULE_INACTIVE', 'Verification earning is not activated.');
    if (!input.successful) return fail('SCAN_FAILED', 'Only successful scans earn.');
    const account = await this.loyalty.getOrCreateAccount(input.userId);

    // Per-day cap (anti-gaming): count today's verification adjustments.
    const entries = await this.loyalty.listEntries(account.id);
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = entries.filter(
      (e) => e.type === 'adjustment' && e.idempotencyKey.startsWith('verify:') && e.createdAt.toISOString().slice(0, 10) === today,
    ).length;
    const cap = rule.rate > 0 ? 5 : 0; // hard structural cap; rule.capPerPeriod refines when set
    if (todayCount >= cap) {
      await this.completion.recordFraudSignal({
        accountId: account.id,
        userId: input.userId,
        signalType: 'VERIFICATION_SCAN_CAP',
        details: { todayCount },
      });
      return fail('DAILY_CAP', 'Verification earning capped for today.');
    }
    try {
      const { entry, replay } = await this.loyalty.append({
        accountId: account.id,
        type: 'adjustment',
        points: rule.rate,
        orderId: null,
        reason: `Verified a genuine product (rule v${rule.version})`,
        idempotencyKey: `verify:${input.code}`, // one earn per code, ever — duplicate codes rejected
        expiresAt: null,
        reversedEntryId: null,
        ruleCode: 'verification_scan',
        ruleVersion: rule.version,
      });
      return { ok: true, points: replay ? 0 : entry.points };
    } catch (error) {
      if ((error as Error).message === 'LOYALTY_IDEMPOTENCY_CONFLICT') {
        return fail('CODE_ALREADY_EARNED', 'This code has already earned points.');
      }
      throw error;
    }
  }
}

/**
 * Manual point adjustment (PART D.4/PART S) — the single most abusable action
 * in the module: mandatory reason, mutating permission at the route, audit
 * entry, and the same idempotent append-only ledger as everything else.
 */
export class ManualAdjustLoyaltyUseCase {
  constructor(
    private readonly loyalty: ILoyaltyRepository,
    private readonly audit: IAuditRepository,
  ) {}

  async execute(input: {
    userId: string;
    points: number; // signed
    reason: string;
    actorId: string;
    idempotencyKey: string;
  }): Promise<{ ok: true; entryId: string } | Fail> {
    if (!Number.isInteger(input.points) || input.points === 0 || Math.abs(input.points) > 1_000_000) {
      return fail('INVALID_POINTS', 'Adjustment must be a non-zero whole number within the fraud ceiling.');
    }
    if (input.reason.trim().length < 10) {
      return fail('REASON_REQUIRED', 'A manual adjustment requires a substantive reason (min 10 characters).');
    }
    if (input.idempotencyKey.trim().length < 8) {
      return fail('IDEMPOTENCY_REQUIRED', 'An idempotency key of at least 8 characters is required.');
    }
    const account = await this.loyalty.getOrCreateAccount(input.userId);
    try {
      const { entry } = await this.loyalty.append({
        accountId: account.id,
        type: 'adjustment',
        points: input.points,
        orderId: null,
        reason: `Manual (${input.actorId.slice(0, 8)}): ${input.reason.trim()}`.slice(0, 300),
        idempotencyKey: `adjust:${input.idempotencyKey.trim()}`,
        expiresAt: null,
        reversedEntryId: null,
      });
      await new CreateAuditLogUseCase(this.audit).execute({
        actorId: input.actorId,
        action: 'LOYALTY_MANUAL_ADJUSTMENT',
        entity: 'loyalty_ledger_entry',
        entityId: entry.id,
        newState: { userId: input.userId, points: input.points, reason: input.reason },
      });
      return { ok: true, entryId: entry.id };
    } catch (error) {
      if ((error as Error).message === 'LOYALTY_IDEMPOTENCY_CONFLICT') {
        return fail('IDEMPOTENCY_CONFLICT', 'That adjustment key was already used for different facts.');
      }
      throw error;
    }
  }
}

/**
 * Tier evaluation (PART L): assigns the highest ACTIVE tier whose threshold
 * the account's lifetime earned points meet. Inactive/unset tiers (thresholds
 * are Rob's PART V #8) assign nothing. Change notifications ride the existing
 * outbox path.
 */
export interface ILoyaltyTierRepository {
  activeTiers(): Promise<Array<{ code: string; name: string; thresholdLifetimePoints: number; rank: number }>>;
  currentAssignment(accountId: string): Promise<{ tierCode: string } | null>;
  assign(accountId: string, tierCode: string): Promise<void>;
}

export class EvaluateTiersUseCase {
  constructor(
    private readonly loyalty: ILoyaltyRepository,
    private readonly completion: ILoyaltyCompletionRepository,
    private readonly tiers: ILoyaltyTierRepository,
    private readonly notifyTierChange: (input: { userId: string; tierCode: string; tierName: string }) => Promise<unknown>,
  ) {}

  async execute(): Promise<{ evaluated: number; changed: number }> {
    const tiers = await this.tiers.activeTiers();
    if (tiers.length === 0) return { evaluated: 0, changed: 0 };
    const ranked = [...tiers].sort((a, b) => b.rank - a.rank); // highest first
    const accounts = await this.completion.listAccountIds();
    let changed = 0;
    for (const { accountId, userId } of accounts) {
      const entries = await this.loyalty.listEntries(accountId);
      const lifetime = entries.filter((e) => e.type === 'earn').reduce((s, e) => s + e.points, 0);
      const target = ranked.find((t) => lifetime >= t.thresholdLifetimePoints);
      if (!target) continue;
      const current = await this.tiers.currentAssignment(accountId);
      if (current?.tierCode === target.code) continue;
      await this.tiers.assign(accountId, target.code);
      changed++;
      await this.notifyTierChange({ userId, tierCode: target.code, tierName: target.name }).catch(() => undefined);
    }
    return { evaluated: accounts.length, changed };
  }
}
