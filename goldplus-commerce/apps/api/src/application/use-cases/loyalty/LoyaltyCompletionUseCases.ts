import {
  budgetCapReached,
  computeBalance,
  computeProRataClawback,
  dueExpiryNotices,
  planRedemption,
} from '../../../domain/loyalty/LoyaltyLedger';
import { ILoyaltyRepository } from '../../ports/ILoyaltyRepository';
import { ILoyaltyCompletionRepository } from '../../ports/ILoyaltyCompletion';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { EarnLoyaltyPointsUseCase, LoyaltyProgrammeGate } from './LoyaltyUseCases';
import { appLogger } from '../../logging/appLogger';

type Fail = { ok: false; code: string; message: string };
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });

/**
 * Vest points on DELIVERY confirmation, not payment (brief PART F).
 *
 * The earn ledger entry is written only when the order reaches
 * delivered/completed while paid — so a refused COD order simply never earns
 * (the hole closes structurally, no clawback needed), and "pending" points are
 * an honest projection over paid-undelivered orders, not ledger rows.
 */
export class VestLoyaltyOnDeliveryUseCase {
  constructor(
    private readonly earn: EarnLoyaltyPointsUseCase,
    private readonly orders: { findLoyaltyEarnSource(orderId: string): Promise<{ userId: string; totalUgx: number } | null> },
    private readonly completion: ILoyaltyCompletionRepository,
  ) {}

  async execute(orderId: string): Promise<void> {
    const source = await this.orders.findLoyaltyEarnSource(orderId);
    if (!source) return; // guest or unpaid — nothing vests
    const config = await this.completion.getProgrammeConfig();
    if (config.killSwitch) return; // PART N kill switch: earning halted without a deploy
    if (budgetCapReached(await this.completion.lifetimeIssuedPoints(), config.budgetCapPoints)) {
      // PART N budget cap: pause earning + alert. The order itself is untouched.
      await this.completion.recordFraudSignal({
        userId: source.userId,
        signalType: 'BUDGET_CAP_PAUSED_EARN',
        severity: 'high',
        details: { orderId, budgetCapPoints: config.budgetCapPoints },
      });
      return;
    }
    const result = await this.earn.execute({ userId: source.userId, orderId, orderTotalUgx: source.totalUgx });
    if (!result.ok && result.code !== 'PROGRAMME_DISABLED' && result.code !== 'INVALID_POINTS') {
      appLogger.error({ orderId, code: result.code }, 'loyalty vesting failed');
    }
  }
}

/**
 * Clawback on refund/chargeback (brief PART F). Writes a `reversal` pointing
 * at the original earn — full or pro-rata. If the points were already spent
 * the balance goes negative and the negative is carried, not forgiven.
 */
export class ClawbackOrderEarnUseCase {
  constructor(
    private readonly repo: ILoyaltyRepository,
    private readonly completion: ILoyaltyCompletionRepository,
    private readonly audit: IAuditRepository,
  ) {}

  async execute(input: {
    orderId: string;
    refundShareBps?: number; // default 10000 = full
    actorId: string | null;
    actorType: 'system' | 'admin';
    reason: string;
  }): Promise<{ ok: true; points: number } | Fail> {
    const earn = await this.completion.findEarnEntryForOrder(input.orderId);
    if (!earn) return fail('NO_EARN', 'No earn entry exists for this order — nothing to claw back.');
    const shareBps = input.refundShareBps ?? 10_000;
    const points = computeProRataClawback(earn.points, shareBps);
    if (points <= 0) return fail('NOTHING_TO_CLAW', 'The refund share claws back zero points.');
    if (!input.reason.trim()) return fail('REASON_REQUIRED', 'A clawback requires a reason.');
    try {
      const { entry, replay } = await this.repo.append({
        accountId: earn.accountId,
        type: 'reversal',
        points: -points,
        orderId: input.orderId,
        reason: `Clawback (${shareBps === 10_000 ? 'full' : `${(shareBps / 100).toFixed(1)}%`}): ${input.reason.trim()}`.slice(0, 300),
        idempotencyKey: `reversal:${earn.id}`,
        expiresAt: null,
        reversedEntryId: earn.id,
      });
      if (replay) return { ok: true, points: -entry.points };
      await new CreateAuditLogUseCase(this.audit).execute({
        actorId: input.actorId ?? null,
        action: 'LOYALTY_CLAWBACK',
        entity: 'loyalty_ledger_entry',
        entityId: entry.id,
        newState: { orderId: input.orderId, points: -points, shareBps, reason: input.reason },
      });
      return { ok: true, points };
    } catch (error) {
      if ((error as Error).message === 'LOYALTY_IDEMPOTENCY_CONFLICT') {
        return fail('ALREADY_CLAWED', 'This earn has already been clawed back.');
      }
      throw error;
    }
  }
}

/**
 * Redemption engine (brief PART G): reserve on application → consume on
 * confirmation (delivery for COD) → release on abandonment → reverse on refund.
 * Reserved points reduce the spendable balance but are NOT ledger entries —
 * the ledger records only consummated facts.
 */
export class ReserveRedemptionUseCase {
  constructor(
    private readonly repo: ILoyaltyRepository,
    private readonly completion: ILoyaltyCompletionRepository,
    private readonly gate: LoyaltyProgrammeGate,
  ) {}

  async execute(input: {
    userId: string;
    points: number;
    orderGoodsTotalUgx: number;
    idempotencyKey: string;
    ttlMinutes?: number;
  }): Promise<{ ok: true; reservationId: string; valueUgx: number } | Fail> {
    if (!(await this.gate.isActive())) return fail('PROGRAMME_DISABLED', 'The loyalty programme is not active.');
    const config = await this.completion.getProgrammeConfig();
    if (config.killSwitch) return fail('PROGRAMME_HALTED', 'The loyalty programme is temporarily paused.');
    const account = await this.repo.getOrCreateAccount(input.userId);
    const entries = await this.repo.listEntries(account.id);
    const balance = computeBalance(entries, new Date());
    const reserved = await this.completion.reservedPoints(account.id);
    const plan = planRedemption({
      points: input.points,
      balanceAvailable: balance.available - reserved,
      orderGoodsTotalUgx: input.orderGoodsTotalUgx,
      config,
    });
    if (!plan.ok) return fail(plan.code, plan.message);
    const ttl = Math.min(Math.max(input.ttlMinutes ?? 120, 10), 24 * 60);
    const row = await this.completion.createReservation({
      accountId: account.id,
      orderId: null,
      pointsReserved: plan.points,
      valueUgx: plan.valueUgx,
      pointValueUgx: plan.pointValueUgx,
      idempotencyKey: `resv:${input.idempotencyKey}`,
      reservedUntil: new Date(Date.now() + ttl * 60_000),
    });
    return { ok: true, reservationId: row.id, valueUgx: row.valueUgx };
  }
}

export class ConsumeRedemptionUseCase {
  constructor(
    private readonly repo: ILoyaltyRepository,
    private readonly completion: ILoyaltyCompletionRepository,
  ) {}

  /** Writes the `redeem` ledger entry. Idempotent per reservation. */
  async execute(input: { reservationId?: string; orderId?: string }): Promise<{ ok: true } | Fail> {
    const reservation = input.reservationId
      ? await this.completion.findReservation(input.reservationId)
      : input.orderId
        ? await this.completion.findReservationByOrder(input.orderId)
        : null;
    if (!reservation) return fail('NOT_FOUND', 'Reservation not found.');
    if (reservation.status === 'applied') return { ok: true }; // idempotent
    if (reservation.status !== 'reserved') return fail('NOT_RESERVED', `Reservation is ${reservation.status}.`);
    const result = await this.repo.appendDebitIfAvailable(
      {
        accountId: reservation.accountId,
        type: 'redeem',
        points: -reservation.pointsReserved,
        orderId: reservation.orderId,
        reason: `Redeemed against order (${reservation.valueUgx.toLocaleString('en-UG')} UGX at ${reservation.pointValueUgx}/pt)`.slice(0, 300),
        idempotencyKey: `redeem:${reservation.id}`,
        expiresAt: null,
        reversedEntryId: null,
      },
      new Date(),
    );
    if (!result.ok) return fail(result.code, result.code === 'INSUFFICIENT_BALANCE' ? 'Balance no longer covers the reservation.' : 'Idempotency conflict.');
    await this.completion.markReservation(reservation.id, 'applied', result.entry.id);
    return { ok: true };
  }
}

export class ReleaseRedemptionUseCase {
  constructor(private readonly completion: ILoyaltyCompletionRepository) {}

  /** An abandoned cart must not eat points (PART G). */
  async execute(input: { reservationId?: string; orderId?: string }): Promise<{ ok: true } | Fail> {
    const reservation = input.reservationId
      ? await this.completion.findReservation(input.reservationId)
      : input.orderId
        ? await this.completion.findReservationByOrder(input.orderId)
        : null;
    if (!reservation) return fail('NOT_FOUND', 'Reservation not found.');
    if (reservation.status === 'released') return { ok: true };
    if (reservation.status !== 'reserved') return fail('NOT_RESERVED', `Reservation is ${reservation.status}.`);
    await this.completion.markReservation(reservation.id, 'released');
    return { ok: true };
  }
}

export class ReverseRedemptionUseCase {
  constructor(
    private readonly repo: ILoyaltyRepository,
    private readonly completion: ILoyaltyCompletionRepository,
  ) {}

  /**
   * Refund path: the points return with their ORIGINAL expiry intact — FIFO
   * re-frees the source earns automatically once the redeem is reversed, and
   * no expiry date is ever extended as a refund side effect.
   */
  async execute(input: { orderId: string; reason: string }): Promise<{ ok: true } | Fail> {
    const reservation = await this.completion.findReservationByOrder(input.orderId);
    if (!reservation) return fail('NOT_FOUND', 'No redemption exists for this order.');
    if (reservation.status === 'reversed') return { ok: true };
    if (reservation.status !== 'applied' || !reservation.ledgerEntryId) {
      return fail('NOT_APPLIED', `Redemption is ${reservation.status}; only applied redemptions reverse.`);
    }
    try {
      await this.repo.append({
        accountId: reservation.accountId,
        type: 'reversal',
        points: reservation.pointsReserved,
        orderId: input.orderId,
        reason: `Redemption reversed: ${input.reason.trim()}`.slice(0, 300),
        idempotencyKey: `reversal:${reservation.ledgerEntryId}`,
        expiresAt: null,
        reversedEntryId: reservation.ledgerEntryId,
      });
    } catch (error) {
      if ((error as Error).message !== 'LOYALTY_IDEMPOTENCY_CONFLICT') throw error;
    }
    await this.completion.markReservation(reservation.id, 'reversed');
    return { ok: true };
  }
}

/**
 * The daily sweep (brief PARTs H/O + orphaned-reconciliation fix): expiry
 * entries FIFO per account, reservation TTL releases, expiry warnings, and the
 * liability snapshot. Every action is a real ledger/audit fact.
 */
export class RunLoyaltyDailySweepUseCase {
  constructor(
    private readonly repo: ILoyaltyRepository,
    private readonly completion: ILoyaltyCompletionRepository,
    private readonly notify: (input: { userId: string; earnEntryId: string; kind: string; pointsExpiring: number; expiresAt: Date }) => Promise<'sent' | 'skipped'>,
  ) {}

  async execute(now = new Date()): Promise<{
    accountsSwept: number;
    entriesExpired: number;
    reservationsReleased: number;
    noticesSent: number;
    snapshotWritten: boolean;
  }> {
    const config = await this.completion.getProgrammeConfig();

    // 1. Reservation TTL releases — an abandoned cart never eats points.
    const expiredReservations = await this.completion.listExpiredReservations(now);
    let reservationsReleased = 0;
    for (const r of expiredReservations) {
      if (await this.completion.markReservation(r.id, 'released')) reservationsReleased++;
    }

    // 2. Expiry entries per account (never touches reserved/in-flight points:
    //    expiry only claims the FIFO remainder after redemptions, and open
    //    reservations belong to accounts whose balance still covers them).
    const accounts = await this.completion.listAccountIds();
    let entriesExpired = 0;
    for (const { accountId } of accounts) {
      const expired = await this.repo.expireDue(accountId, now);
      entriesExpired += expired.length;
    }

    // 3. Expiry warnings — once per (earn, kind), via the consent-gated channel.
    let noticesSent = 0;
    const nearing = await this.completion.listEarnsNearingExpiry(30, now);
    for (const { entry, userId } of nearing) {
      for (const kind of dueExpiryNotices(entry, now)) {
        if (await this.completion.noticeAlreadySent(entry.id, kind)) continue;
        const outcome = await this.notify({
          userId,
          earnEntryId: entry.id,
          kind,
          pointsExpiring: entry.points,
          expiresAt: entry.expiresAt as Date,
        });
        await this.completion.recordNotice({
          accountId: entry.accountId,
          earnEntryId: entry.id,
          kind,
          channel: outcome === 'sent' ? 'notification' : 'suppressed',
        });
        if (outcome === 'sent') noticesSent++;
      }
    }

    // 4. Daily liability snapshot (PART O) — the numbers exist whether or not
    //    the accounting treatment is applied yet.
    const totals = await this.completion.ledgerTotals();
    const redemptionRateBps = totals.issued > 0 ? Math.round((totals.redeemed / totals.issued) * 10_000) : null;
    // Breakage: observed expiry share of issued so far — refined as real data
    // accumulates; null until anything has been issued (never a made-up rate).
    const breakageEstimateBps = totals.issued > 0 ? Math.round((totals.expired / totals.issued) * 10_000) : null;
    let pendingPoints = 0;
    for (const { userId } of accounts) {
      const pending = await this.completion.pendingEarnOrders(userId);
      const cfg = await this.repo.getConfig();
      for (const p of pending) pendingPoints += Math.floor(p.totalUgx / 1000) * cfg.earnRatePer1000Ugx;
    }
    await this.completion.writeLiabilitySnapshot({
      snapshotDate: now.toISOString().slice(0, 10),
      pointsOutstanding: totals.outstanding,
      pointsIssued: totals.issued,
      pointsRedeemed: totals.redeemed,
      pointsExpired: totals.expired,
      pointsClawedBack: totals.clawedBack,
      pendingPoints,
      pointValueUgx: config.pointValueUgx,
      liabilityUgx: config.pointValueUgx !== null ? totals.outstanding * config.pointValueUgx : null,
      breakageEstimateBps,
      redemptionRateBps,
    });

    return {
      accountsSwept: accounts.length,
      entriesExpired,
      reservationsReleased,
      noticesSent,
      snapshotWritten: true,
    };
  }
}
