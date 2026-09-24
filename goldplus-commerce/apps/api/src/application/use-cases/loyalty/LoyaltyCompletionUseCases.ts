import {
  budgetCapReached,
  computeBalance,
  computeEarnRemainders,
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
 * delivered/completed while paid online, or as cash on delivery (the delivery
 * IS the payment — domain/loyalty/LoyaltyEarnEligibility). A refused COD order
 * never reaches delivered, so it simply never earns (the hole closes
 * structurally, no clawback needed), and "pending" points are an honest
 * projection over qualifying undelivered orders, not ledger rows.
 */
export class VestLoyaltyOnDeliveryUseCase {
  constructor(
    private readonly earn: EarnLoyaltyPointsUseCase,
    private readonly orders: { findLoyaltyEarnSource(orderId: string): Promise<{ userId: string; totalUgx: number } | null> },
    private readonly completion: ILoyaltyCompletionRepository,
    /**
     * Optional together. Money refunded BEFORE delivery found no earn to claw
     * (points vest at delivery) and nothing retried it, so the full order
     * total then vested. After vesting, the share refunded to date is clawed
     * back — idempotent on its cumulative key, so a later payment-path
     * clawback of the same share takes nothing more.
     */
    private readonly refunds?: { getRefundedShareBpsForOrder(orderId: string): Promise<number> },
    private readonly applyRefund?: { execute(input: { orderId: string; refundedShareBps: number; reason: string }): Promise<void> },
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
    if (result.ok && this.refunds && this.applyRefund) {
      try {
        const share = await this.refunds.getRefundedShareBpsForOrder(orderId);
        if (share > 0) await this.applyRefund.execute({ orderId, refundedShareBps: share, reason: 'Refunded before delivery' });
      } catch (error) {
        appLogger.error({ orderId, err: (error as Error).message }, 'loyalty refund-before-delivery clawback failed');
      }
    }
  }
}

/**
 * The ONE issuance gate for every NON-order credit (referral, birthday, scan,
 * counterfeit, phone verification, missions, draws, guest backfill).
 *
 * Those use cases each check `config.enabled` and `config.killSwitch`, and
 * nothing else: the deployment key (LOYALTY_PROGRAMME_ENABLED, "no points are
 * issued") and the budget cap stopped order earning only, so referral and
 * scratch-card points kept landing past the cap and with the key off. This
 * wraps their config read so an inactive gate or a reached cap reads as the
 * kill switch they already honour. Manual admin adjustments are not wrapped.
 */
export function guardLoyaltyIssuance(
  completion: ILoyaltyCompletionRepository,
  gate: { isActive(): Promise<boolean> },
): ILoyaltyCompletionRepository {
  const guarded = Object.create(completion) as ILoyaltyCompletionRepository;
  guarded.getProgrammeConfig = async () => {
    const config = await completion.getProgrammeConfig();
    if (!config.enabled || config.killSwitch) return config;
    if (!(await gate.isActive())) return { ...config, killSwitch: true };
    if (budgetCapReached(await completion.lifetimeIssuedPoints(), config.budgetCapPoints)) {
      await completion
        .recordFraudSignal({ signalType: 'BUDGET_CAP_PAUSED_EARN', severity: 'high', details: { source: 'non_order', budgetCapPoints: config.budgetCapPoints } })
        .catch(() => undefined);
      return { ...config, killSwitch: true };
    }
    return config;
  };
  return guarded;
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
    /**
     * The share of the order refunded TO DATE, not this refund's own share.
     * Used by the payment path, which re-reads the same refund total on every
     * poll: only the difference between this target and what was already clawed
     * is taken, so asking again never claws twice.
     */
    cumulativeShareBps?: number;
    actorId: string | null;
    actorType: 'system' | 'admin';
    reason: string;
  }): Promise<{ ok: true; points: number } | Fail> {
    const earn = await this.completion.findEarnEntryForOrder(input.orderId);
    if (!earn) return fail('NO_EARN', 'No earn entry exists for this order — nothing to claw back.');
    const shareBps = input.cumulativeShareBps ?? input.refundShareBps ?? 10_000;
    const target = computeProRataClawback(earn.points, shareBps);
    if (target <= 0) return fail('NOTHING_TO_CLAW', 'The refund share claws back zero points.');
    if (!input.reason.trim()) return fail('REASON_REQUIRED', 'A clawback requires a reason.');
    // An order can be refunded more than once. Keyed on the earn entry alone,
    // the second partial refund reused the first one's key, was treated as a
    // replay and clawed back nothing while reporting success. The key is the
    // RUNNING TOTAL clawed against this earn, so a retry of the same refund is
    // still deduplicated but a genuine second refund is not.
    const alreadyClawed = await this.completion.sumReversedPointsForEntry(earn.id);
    const remaining = Math.max(0, earn.points - alreadyClawed);
    if (remaining <= 0) return fail('NOTHING_TO_CLAW', 'This order has already been fully clawed back.');
    const points = input.cumulativeShareBps !== undefined ? target - alreadyClawed : target;
    if (points <= 0) return fail('NOTHING_TO_CLAW', 'This refund share has already been clawed back.');
    const clawback = Math.min(points, remaining);
    const cumulative = alreadyClawed + clawback;
    try {
      const { entry, replay } = await this.repo.append({
        accountId: earn.accountId,
        type: 'reversal',
        points: -clawback,
        orderId: input.orderId,
        reason: `Clawback (${shareBps === 10_000 ? 'full' : `${(shareBps / 100).toFixed(1)}%`}): ${input.reason.trim()}`.slice(0, 300),
        idempotencyKey: `reversal:${earn.id}:${cumulative}`,
        expiresAt: null,
        reversedEntryId: earn.id,
      });
      if (replay) return { ok: true, points: -entry.points };
      await new CreateAuditLogUseCase(this.audit).execute({
        actorId: input.actorId ?? null,
        action: 'LOYALTY_CLAWBACK',
        entity: 'loyalty_ledger_entry',
        entityId: entry.id,
        newState: { orderId: input.orderId, points: -clawback, shareBps, reason: input.reason },
      });
      return { ok: true, points: clawback };
    } catch (error) {
      if ((error as Error).message === 'LOYALTY_IDEMPOTENCY_CONFLICT') {
        return fail('ALREADY_CLAWED', 'This earn has already been clawed back.');
      }
      // A database still carrying the one-reversal-per-earn index (before
      // migration 0151) refuses a second partial clawback. Say so plainly
      // instead of failing the caller with a raw constraint error.
      if (/loyalty_ledger_reversal_source_idx/.test(String((error as Error)?.message ?? '')) || (error as { code?: string })?.code === '23505') {
        return fail('MANUAL_REQUIRED', 'A second partial clawback on this earn needs a manual adjustment until the ledger index is migrated.');
      }
      throw error;
    }
  }
}

/**
 * Loyalty follow-up for money that went back to the customer, driven by the
 * PAYMENT fact rather than the order lifecycle.
 *
 * The lifecycle path (order -> cancelled with payment reversed) cannot run for
 * the orders that matter most: points vest on delivered/completed, both
 * terminal, so a refund of a delivered order could never cancel it and the
 * customer kept the points; a proven partial refund never moves the order at
 * all. Both steps are idempotent, and a loyalty failure never fails the
 * payment verification that called it.
 */
export class ApplyRefundToLoyaltyUseCase {
  constructor(
    private readonly clawback: Pick<ClawbackOrderEarnUseCase, 'execute'>,
    private readonly reverseRedemption: Pick<ReverseRedemptionUseCase, 'execute'>,
  ) {}

  async execute(input: { orderId: string; refundedShareBps: number; reason: string }): Promise<void> {
    const share = Math.min(Math.max(Math.floor(input.refundedShareBps), 0), 10_000);
    if (share <= 0) return;
    await this.clawback
      .execute({ orderId: input.orderId, cumulativeShareBps: share, actorId: null, actorType: 'system', reason: input.reason })
      .catch((error) => appLogger.error({ orderId: input.orderId, err: (error as Error).message }, 'loyalty refund clawback failed'));
    // Points spent on the order come back only when ALL of the money did.
    if (share >= 10_000) {
      await this.reverseRedemption
        .execute({ orderId: input.orderId, reason: input.reason })
        .catch((error) => appLogger.error({ orderId: input.orderId, err: (error as Error).message }, 'loyalty refund redemption reversal failed'));
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
    // After a merge the points live on the survivor; the merged login must not
    // spend them a second time.
    if (await this.repo.mergedInto(account.id)) {
      return fail('ACCOUNT_MERGED', 'These points were moved to your other account. Sign in there to use them.');
    }
    const entries = await this.repo.listEntries(account.id);
    const balance = computeBalance(entries, new Date());
    const reserved = await this.completion.reservedPoints(account.id);
    // Points already past their expiry are still in `available` until the
    // sweep writes the expiry entry; they must not be promised to an order.
    const spendable = balance.available - balance.pendingExpiry;
    const plan = planRedemption({
      points: input.points,
      balanceAvailable: spendable - reserved,
      orderGoodsTotalUgx: input.orderGoodsTotalUgx,
      config,
    });
    if (!plan.ok) return fail(plan.code, plan.message);
    const ttl = Math.min(Math.max(input.ttlMinutes ?? 120, 10), 24 * 60);
    const row = await this.completion.createReservation({
      // The check above is an early exit; this is the one that actually holds,
      // because it is applied inside the same transaction as the insert.
      maxTotalReservedPoints: spendable,
      accountId: account.id,
      orderId: null,
      pointsReserved: plan.points,
      valueUgx: plan.valueUgx,
      pointValueUgx: plan.pointValueUgx,
      idempotencyKey: `resv:${input.idempotencyKey}`,
      reservedUntil: new Date(Date.now() + ttl * 60_000),
    });
    if (!row) return fail('INSUFFICIENT_POINTS', 'Those points are already committed to another order.');
    return { ok: true, reservationId: row.id, valueUgx: row.valueUgx };
  }
}

/**
 * Customers cannot spend points: the kill switch is on, the programme is off,
 * redemption is not configured yet (no point value), or the deployment key is
 * off. While this holds no points expire, by the sweep or by a debit.
 */
export function isRedemptionHalted(
  config: Pick<
    Awaited<ReturnType<ILoyaltyCompletionRepository['getProgrammeConfig']>>,
    'killSwitch' | 'enabled' | 'pointValueUgx' | 'redemptionMinPoints' | 'redemptionMaxShareBps'
  >,
  gateActive: boolean,
): boolean {
  const redemptionUnconfigured =
    config.pointValueUgx == null || config.redemptionMinPoints == null || config.redemptionMaxShareBps == null;
  return config.killSwitch || !config.enabled || redemptionUnconfigured || !gateActive;
}

export class ConsumeRedemptionUseCase {
  constructor(
    private readonly repo: ILoyaltyRepository,
    private readonly completion: ILoyaltyCompletionRepository,
    /** Optional: the deployment key, read only to tell whether redemption is paused. */
    private readonly gate?: { isActive(): Promise<boolean> },
  ) {}

  /**
   * A reservation made before a pause can still be applied at delivery. The
   * debit itself stands (the discount was already given), but it must not
   * expire points on the side: while redemption is paused, none expire. An
   * unreadable config keeps the ordinary behaviour.
   */
  private async redemptionPaused(): Promise<boolean> {
    try {
      const config = await this.completion.getProgrammeConfig();
      return isRedemptionHalted(config, this.gate ? await this.gate.isActive() : true);
    } catch {
      return false;
    }
  }

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
      { expireDue: !(await this.redemptionPaused()) },
    );
    if (!result.ok) return fail(result.code, result.code === 'INSUFFICIENT_BALANCE' ? 'Balance no longer covers the reservation.' : 'Idempotency conflict.');
    await this.completion.markReservation(reservation.id, 'applied', result.entry.id);
    return { ok: true };
  }

  /**
   * Delivery settles a COD redemption. The order is delivered (terminal) and
   * its discount already given, so a failure here can never be retried by the
   * lifecycle: it is REPORTED (error log + ops signal) and the reservation is
   * released, so it stops shrinking every future redemption for the customer.
   */
  async settleOnDelivery(orderId: string): Promise<{ ok: true } | Fail> {
    const result = await this.execute({ orderId });
    if (result.ok || result.code === 'NOT_FOUND' || result.code === 'NOT_RESERVED') return result;
    const reservation = await this.completion.findReservationByOrder(orderId);
    appLogger.error({ orderId, code: result.code, reservationId: reservation?.id ?? null }, 'loyalty redemption could not be consumed at delivery');
    await this.completion
      .recordFraudSignal({
        accountId: reservation?.accountId ?? null,
        signalType: 'REDEMPTION_CONSUME_FAILED_AT_DELIVERY',
        severity: 'high',
        details: { orderId, code: result.code, pointsReserved: reservation?.pointsReserved ?? null, valueUgx: reservation?.valueUgx ?? null },
      })
      .catch(() => undefined);
    if (reservation && reservation.status === 'reserved') await this.completion.markReservation(reservation.id, 'released');
    return result;
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
    /** Optional: the deployment key. Off, redemption refuses PROGRAMME_DISABLED, so expiry pauses too. */
    private readonly gate?: { isActive(): Promise<boolean> },
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

    // While redemption is halted (kill switch) or the programme is off,
    // customers cannot spend points, so none may expire and nobody may be
    // told to "use them before then" (owner decision 2026-09-24; brief PART
    // H). The account page promises points "become usable if it is
    // reactivated". Reservation releases and the snapshot still run.
    // Redemption not configured yet (no point value) is the same position:
    // the terms promise such points "remain valid".
    const redemptionHalted = isRedemptionHalted(config, this.gate ? await this.gate.isActive() : true);

    // 2. Expiry entries per account. Never touches reserved/in-flight points:
    //    expiry claims only the FIFO remainder after redemptions AND open
    //    reservations (the repository reads them inside the same lock). A
    //    merged-away account is expired by its survivor, over one balance.
    const accounts = await this.completion.listAccountIds();
    let entriesExpired = 0;
    for (const { accountId } of redemptionHalted ? [] : accounts) {
      const expired = await this.repo.expireDue(accountId, now);
      entriesExpired += expired.length;
    }

    // 3. Expiry warnings — once per (earn, kind), via the consent-gated channel.
    //    Only for points the customer still HOLDS: the FIFO remainder of the
    //    earn after redemptions (and open reservations). Warning about the
    //    original earn told customers with a zero balance to "use them before
    //    they expire" — urgency about points that no longer existed.
    let noticesSent = 0;
    const nearing = redemptionHalted ? [] : await this.completion.listEarnsNearingExpiry(30, now);
    const remaindersByAccount = new Map<string, Map<string, number>>();
    const remainderOf = async (accountId: string, earnId: string): Promise<number> => {
      // The same balance expiry uses: a merged-away account's earns are
      // spent by its survivor's redemptions.
      const owner = (await this.repo.mergedInto(accountId)) ?? accountId;
      let map = remaindersByAccount.get(owner);
      if (!map) {
        const [entries, reserved] = await Promise.all([this.repo.listEntries(owner), this.completion.reservedPoints(owner)]);
        map = new Map(computeEarnRemainders(entries, reserved).map((r) => [r.entry.id, r.points]));
        remaindersByAccount.set(owner, map);
      }
      return map.get(earnId) ?? 0;
    };
    for (const { entry, userId } of nearing) {
      const pointsExpiring = await remainderOf(entry.accountId, entry.id);
      if (pointsExpiring <= 0) continue;
      for (const kind of dueExpiryNotices(entry, now)) {
        if (await this.completion.noticeAlreadySent(entry.id, kind)) continue;
        const outcome = await this.notify({
          userId,
          earnEntryId: entry.id,
          kind,
          pointsExpiring,
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
