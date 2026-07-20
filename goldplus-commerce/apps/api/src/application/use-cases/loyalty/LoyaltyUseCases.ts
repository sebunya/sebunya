import { ILoyaltyRepository } from '../../ports/ILoyaltyRepository';
import {
  LoyaltyBalance,
  LoyaltyConfig,
  LoyaltyLedgerEntry,
  computeBalance,
  computeEarnPoints,
  validateEarn,
  validateRedeem,
  validateLoyaltyConfig,
} from '../../../domain/loyalty/LoyaltyLedger';

export type LoyaltyResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

const DISABLED: { ok: false; code: string; message: string } = {
  ok: false,
  code: 'PROGRAMME_DISABLED',
  message: 'GoldPlus Rewards is not active. No points are being issued or redeemed.',
};

/**
 * Slice 8: all mutations require BOTH the environment flag and the admin
 * config switch. Neither is enabled anywhere in this codebase — commercial
 * activation is a separate, operator-approved step.
 */
export class LoyaltyProgrammeGate {
  constructor(
    private readonly repo: ILoyaltyRepository,
    private readonly envFlag: () => boolean
  ) {}

  async isActive(): Promise<boolean> {
    if (!this.envFlag()) return false;
    const config = await this.repo.getConfig();
    return config.enabled;
  }
}

export class EarnLoyaltyPointsUseCase {
  constructor(
    private readonly repo: ILoyaltyRepository,
    private readonly gate: LoyaltyProgrammeGate
  ) {}

  /** Earn from a real paid order only; idempotent per order. */
  async execute(input: { userId: string; orderId: string; orderTotalUgx: number }): Promise<LoyaltyResult<LoyaltyLedgerEntry>> {
    if (!(await this.gate.isActive())) return DISABLED;
    const config = await this.repo.getConfig();
    const points = computeEarnPoints(input.orderTotalUgx, config);
    const valid = validateEarn(points, input.orderId);
    if (!valid.ok) return valid;
    const account = await this.repo.getOrCreateAccount(input.userId);
    const idempotencyKey = `earn:${input.orderId}`;
    const existing = await this.repo.findEntryByIdempotencyKey(idempotencyKey);
    if (existing) {
      return existing.accountId === account.id && existing.type === 'earn' && existing.points === points && existing.orderId === input.orderId
        ? { ok: true, value: existing }
        : { ok: false, code: 'IDEMPOTENCY_CONFLICT', message: 'The order earn key was already used for different ledger facts.' };
    }
    const earnedOn = new Date();
    const expiresAt = config.expiryDays > 0
      ? new Date(Date.UTC(earnedOn.getUTCFullYear(), earnedOn.getUTCMonth(), earnedOn.getUTCDate() + config.expiryDays))
      : null;
    try {
      const { entry } = await this.repo.append({
        accountId: account.id,
        type: 'earn',
        points,
        orderId: input.orderId,
        reason: `Earned on order (rate ${config.earnRatePer1000Ugx}/1000 UGX)`,
        idempotencyKey,
        expiresAt,
        reversedEntryId: null,
      });
      return { ok: true, value: entry };
    } catch (error) {
      if ((error as Error).message === 'LOYALTY_IDEMPOTENCY_CONFLICT') {
        return { ok: false, code: 'IDEMPOTENCY_CONFLICT', message: 'The order earn key was already used for different ledger facts.' };
      }
      throw error;
    }
  }
}

export class RedeemLoyaltyPointsUseCase {
  constructor(
    private readonly repo: ILoyaltyRepository,
    private readonly gate: LoyaltyProgrammeGate
  ) {}

  async execute(input: { userId: string; points: number; reason: string; idempotencyKey: string }): Promise<LoyaltyResult<LoyaltyLedgerEntry>> {
    if (!(await this.gate.isActive())) return DISABLED;
    if (!input.idempotencyKey || input.idempotencyKey.length < 8) {
      return { ok: false, code: 'IDEMPOTENCY_REQUIRED', message: 'An idempotency key of at least 8 characters is required.' };
    }
    const account = await this.repo.getOrCreateAccount(input.userId);
    const now = new Date();
    const entries = await this.repo.listEntries(account.id);
    const balance = computeBalance(entries, now);
    const valid = validateRedeem(input.points, balance);
    if (!valid.ok) return valid;
    const result = await this.repo.appendDebitIfAvailable({
      accountId: account.id,
      type: 'redeem',
      points: -input.points,
      orderId: null,
      reason: input.reason?.slice(0, 300) || 'Redemption',
      idempotencyKey: `redeem:${input.idempotencyKey}`,
      expiresAt: null,
      reversedEntryId: null,
    }, now);
    if (!result.ok) {
      return result.code === 'INSUFFICIENT_BALANCE'
        ? { ok: false, code: result.code, message: 'Redemption exceeds the transactionally verified available balance.' }
        : { ok: false, code: result.code, message: 'The redemption key was already used for different ledger facts.' };
    }
    return { ok: true, value: result.entry };
  }
}

export class ExpireLoyaltyPointsUseCase {
  constructor(private readonly repo: ILoyaltyRepository) {}

  async execute(input: { accountId: string; now?: Date }): Promise<LoyaltyLedgerEntry[]> {
    return this.repo.expireDue(input.accountId, input.now ?? new Date());
  }
}

export class ReverseLoyaltyEntryUseCase {
  constructor(private readonly repo: ILoyaltyRepository) {}

  /** Admin repair path (refunds, fraud). Idempotent per reversed entry. */
  async execute(input: { entryId: string; reason: string }): Promise<LoyaltyResult<LoyaltyLedgerEntry>> {
    const result = await this.repo.reverseEntry(input.entryId, input.reason);
    if (result.ok) return { ok: true, value: result.entry };
    const messages: Record<typeof result.code, string> = {
      NOT_FOUND: 'Ledger entry not found.',
      NON_REVERSIBLE: 'Expiry and reversal entries cannot be reversed.',
      ALREADY_REVERSED: 'The ledger entry is already expired or reversed.',
      IDEMPOTENCY_CONFLICT: 'The reversal key was already used for different ledger facts.',
    };
    return { ok: false, code: result.code, message: messages[result.code] };
  }
}

export interface LoyaltyHistory {
  programmeActive: boolean;
  balance: LoyaltyBalance;
  entries: LoyaltyLedgerEntry[];
}

export class GetLoyaltyHistoryUseCase {
  constructor(
    private readonly repo: ILoyaltyRepository,
    private readonly gate: LoyaltyProgrammeGate
  ) {}

  async execute(input: { userId: string }): Promise<LoyaltyHistory> {
    const account = await this.repo.findAccountByUserId(input.userId);
    const entries = account ? await this.repo.listEntries(account.id) : [];
    return {
      programmeActive: await this.gate.isActive(),
      balance: computeBalance(entries, new Date()),
      entries,
    };
  }
}

export class GetLoyaltyOperationsUseCase {
  constructor(private readonly repo: ILoyaltyRepository) {}

  async execute(input: { limit?: number } = {}) {
    return this.repo.getOperationsSnapshot({ now: new Date(), limit: input.limit ?? 50 });
  }
}

export class GetLoyaltyConfigUseCase {
  constructor(private readonly repo: ILoyaltyRepository) {}
  async execute(): Promise<LoyaltyConfig> {
    return this.repo.getConfig();
  }
}

export class SaveLoyaltyConfigUseCase {
  constructor(private readonly repo: ILoyaltyRepository) {}
  async execute(input: Record<string, unknown>): Promise<LoyaltyResult<LoyaltyConfig>> {
    const validated = validateLoyaltyConfig(input);
    if (!validated.ok) return validated;
    const saved = await this.repo.saveConfig(validated.value);
    return { ok: true, value: saved };
  }
}
