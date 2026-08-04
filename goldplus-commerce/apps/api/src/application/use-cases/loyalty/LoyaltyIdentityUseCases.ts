import { ILoyaltyRepository } from '../../ports/ILoyaltyRepository';
import { ILoyaltyCompletionRepository } from '../../ports/ILoyaltyCompletion';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { normalizeUgandanPhone } from '@goldplus/shared';

type Fail = { ok: false; code: string; message: string };
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });

/**
 * Identity + guest backfill + merge ports (loyalty brief PART I).
 */
export interface ILoyaltyIdentityRepository {
  createOtp(input: { userId: string; phoneE164: string; codeHash: string; expiresAt: Date }): Promise<void>;
  latestOtp(userId: string): Promise<{ id: string; phoneE164: string; codeHash: string; attempts: number; expiresAt: Date; consumedAt: Date | null } | null>;
  bumpOtpAttempts(id: string): Promise<number>;
  consumeOtp(id: string): Promise<void>;
  markPhoneVerified(userId: string, phoneE164: string): Promise<void>;
  phoneVerifiedAt(userId: string): Promise<Date | null>;
  /** Guest orders (no user_id) paid+delivered/completed for this exact phone within the window. */
  guestOrdersForPhone(phoneE164: string, lookbackDays: number): Promise<Array<{ orderId: string; totalUgx: number; buyerType: string }>>;
  recordMerge(input: { mergedAccountId: string; survivorAccountId: string; actorId: string | null; note: string | null }): Promise<boolean>;
  mergedInto(accountId: string): Promise<string | null>;
  /** Every merged account whose survivor is this account. */
  mergedSources(survivorAccountId: string): Promise<string[]>;
}

export interface IOtpSender {
  send(phoneE164: string, code: string): Promise<'sent' | 'skipped'>;
}

export class RequestPhoneVerificationUseCase {
  constructor(
    private readonly identity: ILoyaltyIdentityRepository,
    private readonly sender: IOtpSender,
    private readonly hash: (v: string) => string,
    private readonly random: () => string,
  ) {}

  async execute(input: { userId: string; phone: string }): Promise<{ ok: true } | Fail> {
    const phone = normalizeUgandanPhone(input.phone);
    if (!phone) return fail('INVALID_PHONE', 'Enter a valid Ugandan phone number.');
    const code = this.random();
    await this.identity.createOtp({
      userId: input.userId,
      phoneE164: phone.e164,
      codeHash: this.hash(code),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const outcome = await this.sender.send(phone.e164, code);
    if (outcome === 'skipped') return fail('SEND_UNAVAILABLE', 'The verification message could not be sent right now.');
    return { ok: true };
  }
}

export class VerifyPhoneUseCase {
  constructor(
    private readonly identity: ILoyaltyIdentityRepository,
    private readonly hash: (v: string) => string,
    private readonly backfill: BackfillGuestOrdersUseCase,
    private readonly audit: IAuditRepository,
  ) {}

  async execute(input: { userId: string; code: string }): Promise<{ ok: true; backfilledPoints: number } | Fail> {
    const otp = await this.identity.latestOtp(input.userId);
    if (!otp || otp.consumedAt) return fail('NO_CODE', 'Request a new verification code.');
    if (otp.expiresAt.getTime() < Date.now()) return fail('EXPIRED', 'The code expired — request a new one.');
    const attempts = await this.identity.bumpOtpAttempts(otp.id);
    if (attempts > 5) return fail('TOO_MANY_ATTEMPTS', 'Too many attempts — request a new code.');
    if (this.hash(input.code.trim()) !== otp.codeHash) return fail('WRONG_CODE', 'That code is not correct.');
    await this.identity.consumeOtp(otp.id);
    await this.identity.markPhoneVerified(input.userId, otp.phoneE164);
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.userId,
      action: 'PHONE_VERIFIED',
      entity: 'user',
      entityId: input.userId,
      newState: { phoneVerified: true },
    });
    // PART I: verified phone unlocks the guest-order backfill — the single
    // largest uplift in the programme. Config-gated; nulls keep it off.
    const backfilled = await this.backfill.execute({ userId: input.userId, phoneE164: otp.phoneE164 });
    return { ok: true, backfilledPoints: backfilled.ok ? backfilled.points : 0 };
  }
}

/**
 * Guest order backfill (PART I): VERIFIED phone only, lookback + cap from
 * config (null = feature off — Rob's PART V #11), one credit per order ever
 * (the ledger's earn:orderId idempotency key), refunded orders ineligible
 * (only delivered/completed paid orders are returned by the reader).
 */
export class BackfillGuestOrdersUseCase {
  constructor(
    private readonly identity: ILoyaltyIdentityRepository,
    private readonly loyalty: ILoyaltyRepository,
    private readonly completion: ILoyaltyCompletionRepository,
    private readonly audit: IAuditRepository,
  ) {}

  async execute(input: { userId: string; phoneE164: string }): Promise<{ ok: true; points: number; orders: number } | Fail> {
    const config = await this.completion.getProgrammeConfig();
    if (!config.enabled || config.killSwitch) return fail('PROGRAMME_DISABLED', 'The programme is not active.');
    if (config.guestBackfillLookbackDays === null || config.guestBackfillCapPoints === null) {
      return fail('BACKFILL_NOT_CONFIGURED', 'Guest backfill is not configured yet.');
    }
    const verified = await this.identity.phoneVerifiedAt(input.userId);
    if (!verified) return fail('PHONE_NOT_VERIFIED', 'Verify the phone first — never an unverified match.');
    const orders = await this.identity.guestOrdersForPhone(input.phoneE164, config.guestBackfillLookbackDays);
    const account = await this.loyalty.getOrCreateAccount(input.userId);
    let pointsTotal = 0;
    let credited = 0;
    for (const order of orders) {
      if (order.buyerType !== 'retail') continue; // PART K exclusion holds here too
      const points = Math.min(
        Math.floor(order.totalUgx / 1000) * config.earnRatePer1000Ugx,
        config.guestBackfillCapPoints - pointsTotal,
      );
      if (points <= 0) break; // per-customer cap reached
      const earnedOn = new Date();
      const expiresAt = config.expiryDays > 0
        ? new Date(Date.UTC(earnedOn.getUTCFullYear(), earnedOn.getUTCMonth(), earnedOn.getUTCDate() + config.expiryDays))
        : null;
      try {
        const { replay } = await this.loyalty.append({
          accountId: account.id,
          type: 'earn',
          points,
          orderId: order.orderId,
          reason: `Guest order backfill on verified phone (${config.earnRatePer1000Ugx}/1000 UGX)`,
          idempotencyKey: `earn:${order.orderId}`, // one credit per order, ever
          expiresAt,
          reversedEntryId: null,
          ruleCode: 'order_earn',
          ruleVersion: 1,
        });
        if (!replay) {
          pointsTotal += points;
          credited++;
        }
      } catch {
        /* idempotency conflict = already credited under different facts — skip, never force */
      }
    }
    if (credited > 0) {
      await new CreateAuditLogUseCase(this.audit).execute({
        actorId: input.userId,
        action: 'LOYALTY_GUEST_BACKFILL',
        entity: 'loyalty_account',
        entityId: account.id,
        newState: { orders: credited, points: pointsTotal, lookbackDays: config.guestBackfillLookbackDays },
      });
    }
    return { ok: true, points: pointsTotal, orders: credited };
  }
}

/**
 * Account merge (PART I): the ledger is immutable, so entries are never moved
 * or re-dated — the merge is a recorded fact and balance reads aggregate
 * across merged accounts with every original earn/expiry date intact.
 */
export class MergeLoyaltyAccountsUseCase {
  constructor(
    private readonly identity: ILoyaltyIdentityRepository,
    private readonly audit: IAuditRepository,
  ) {}

  async execute(input: { mergedAccountId: string; survivorAccountId: string; actorId: string; note: string }): Promise<{ ok: true } | Fail> {
    if (input.mergedAccountId === input.survivorAccountId) return fail('SAME_ACCOUNT', 'Cannot merge an account into itself.');
    if (!input.note.trim()) return fail('REASON_REQUIRED', 'A merge requires a reason.');
    if (await this.identity.mergedInto(input.survivorAccountId)) {
      return fail('SURVIVOR_MERGED', 'The survivor account was itself merged — merge into the final survivor.');
    }
    const recorded = await this.identity.recordMerge({
      mergedAccountId: input.mergedAccountId,
      survivorAccountId: input.survivorAccountId,
      actorId: input.actorId,
      note: input.note.trim(),
    });
    if (!recorded) return fail('ALREADY_MERGED', 'That account is already merged.');
    // Audit trail on BOTH records (PART I).
    const auditor = new CreateAuditLogUseCase(this.audit);
    await auditor.execute({
      actorId: input.actorId,
      action: 'LOYALTY_ACCOUNTS_MERGED',
      entity: 'loyalty_account',
      entityId: input.mergedAccountId,
      newState: { mergedInto: input.survivorAccountId, note: input.note },
    });
    await auditor.execute({
      actorId: input.actorId,
      action: 'LOYALTY_ACCOUNTS_MERGED',
      entity: 'loyalty_account',
      entityId: input.survivorAccountId,
      newState: { absorbed: input.mergedAccountId, note: input.note },
    });
    return { ok: true };
  }
}
