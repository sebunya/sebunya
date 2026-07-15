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
    const expiresAt = config.expiryDays > 0 ? new Date(Date.now() + config.expiryDays * 24 * 60 * 60 * 1000) : null;
    const { entry } = await this.repo.append({
      accountId: account.id,
      type: 'earn',
      points,
      orderId: input.orderId,
      reason: `Earned on order (rate ${config.earnRatePer1000Ugx}/1000 UGX)`,
      idempotencyKey: `earn:${input.orderId}`,
      expiresAt,
      reversedEntryId: null,
    });
    return { ok: true, value: entry };
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
    const entries = await this.repo.listEntries(account.id);
    const balance = computeBalance(entries, new Date());
    const valid = validateRedeem(input.points, balance);
    if (!valid.ok) return valid;
    const { entry } = await this.repo.append({
      accountId: account.id,
      type: 'redeem',
      points: -input.points,
      orderId: null,
      reason: input.reason?.slice(0, 300) || 'Redemption',
      idempotencyKey: `redeem:${input.idempotencyKey}`,
      expiresAt: null,
      reversedEntryId: null,
    });
    return { ok: true, value: entry };
  }
}

export class ReverseLoyaltyEntryUseCase {
  constructor(private readonly repo: ILoyaltyRepository) {}

  /** Admin repair path (refunds, fraud). Idempotent per reversed entry. */
  async execute(input: { entryId: string; reason: string }): Promise<LoyaltyResult<LoyaltyLedgerEntry>> {
    const target = await this.repo.findEntryById(input.entryId);
    if (!target) return { ok: false, code: 'NOT_FOUND', message: 'Ledger entry not found.' };
    if (target.type === 'reversal') return { ok: false, code: 'ALREADY_REVERSAL', message: 'A reversal cannot be reversed.' };
    const { entry } = await this.repo.append({
      accountId: target.accountId,
      type: 'reversal',
      points: -target.points,
      orderId: target.orderId,
      reason: input.reason?.slice(0, 300) || `Reversal of ${target.type}`,
      idempotencyKey: `reversal:${target.id}`,
      expiresAt: null,
      reversedEntryId: target.id,
    });
    return { ok: true, value: entry };
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
    const account = await this.repo.getOrCreateAccount(input.userId);
    const entries = await this.repo.listEntries(account.id);
    return {
      programmeActive: await this.gate.isActive(),
      balance: computeBalance(entries, new Date()),
      entries,
    };
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
