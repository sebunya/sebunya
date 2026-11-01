import { ILoyaltyRepository } from '../../ports/ILoyaltyRepository';
import { ILoyaltyCompletionRepository } from '../../ports/ILoyaltyCompletion';
import { normaliseReferralCode, type ReferralHoldReason, type ReferralSource } from '../../../domain/loyalty/Referral';

type Fail = { ok: false; code: string; message: string };
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });

/**
 * Gamification LIVE engine (Rob's 2026-08-05 activation of the loyalty brief
 * PARTs G/J/L deferrals). Every point award flows through the append-only
 * ledger as an idempotent `adjustment`; badges are unique per (user, badge);
 * the kill switch and programme-enabled gate stop everything without a deploy.
 * Chance-based mechanics are deliberately absent — the brief's PART P legal
 * hard stop still governs them.
 */

export interface ActiveMission {
  id: string;
  key: string;
  title: string;
  description: string | null;
  kind: string; // PURCHASE_COUNT | VERIFICATION_COUNT | STREAK_ORDERS | REVIEW_COUNT | REFERRAL_COUNT
  threshold: number;
  rewardPoints: number;
  badgeKey: string | null;
}

export interface IGamificationLiveRepository {
  listActiveMissions(): Promise<ActiveMission[]>;
  /**
   * Progress toward one mission for one user, from VERIFIED data only.
   * Returns null when the kind has no attributable data source for this user
   * (never a fake zero).
   */
  missionProgress(userId: string, mission: ActiveMission, opts: { streakWindowDays: number | null }): Promise<number | null>;
  /** Users who already meet a mission's threshold but hold no award for it. */
  missionCatchUpCandidates(mission: ActiveMission, limit: number): Promise<string[]>;
  /** True when newly awarded; false when already held or badge unknown. */
  awardBadgeByKey(userId: string, badgeKey: string): Promise<boolean>;
}

export interface ILoyaltyReferralRepository {
  getOrCreateCode(userId: string): Promise<string>;
  findReferrerByCode(code: string): Promise<{ userId: string; phone: string | null } | null>;
  userPhone(userId: string): Promise<string | null>;
  recordReferral(input: { code: string; referrerUserId: string; refereeUserId: string; source?: ReferralSource }): Promise<'recorded' | 'duplicate'>;
  findPendingByReferee(refereeUserId: string): Promise<{ id: string; code: string; referrerUserId: string } | null>;
  /** 0202: one referral by id, for a person deciding a held one. */
  findById?(id: string): Promise<{ id: string; status: string; referrerUserId: string; refereeUserId: string; qualifyingOrderId: string | null } | null>;
  markAwarded(id: string, referrerEntryId: string, refereeEntryId: string, qualifyingOrderId: string, decidedBy?: string | null): Promise<void>;
  /** 0202: waits for a person; the order it would pay on is kept so a release pays on it. */
  markHeld?(id: string, reason: ReferralHoldReason, qualifyingOrderId: string): Promise<void>;
  markRejected(id: string, reason: string, decidedBy?: string | null): Promise<void>;
  countAwardedForReferrer(referrerUserId: string, sinceDays: number): Promise<number>;
  countDeliveredRetailOrders(userId: string): Promise<number>;
  /**
   * Was this (the referee's qualifying) order delivered to a phone the REFERRER uses: their account phone or one on
   * their own orders? Optional so older fakes type.
   */
  orderUsesReferrerPhone?(orderId: string, referrerUserId: string): Promise<boolean>;
  listForReferrer(referrerUserId: string): Promise<Array<{ status: string; createdAt: Date; friendName?: string | null; friendHasOrdered?: boolean; rejectionReason?: string | null }>>;
}

/**
 * Mission kinds with a real, attributable data source (DrizzleGamificationRepository
 * .missionProgress). REVIEW_COUNT and STREAK_DAYS evaluate to "not evaluable",
 * so a mission of either kind could never complete: it may exist as a DRAFT
 * but is never created new or activated.
 */
export const EVALUABLE_MISSION_KINDS = ['PURCHASE_COUNT', 'STREAK_ORDERS', 'REFERRAL_COUNT', 'VERIFICATION_COUNT'] as const;
export const MISSION_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
/** Ceiling for a single mission bonus, so a typo cannot mint a fortune. */
export const MISSION_REWARD_MAX_POINTS = 10_000;

/**
 * Catch-up for REFERRAL missions whose completing event has already passed:
 * Friends & Family activated after customers qualified, or a referrer who
 * reached the threshold before referrers were evaluated at all. Candidates are
 * evaluated by the same once-ever use case, so a re-run never pays twice.
 *
 * Referrals only, on purpose. Awarded referrals exist only since the programme
 * went live, so this pays nothing for history from before it. Order and scan
 * counts reach back to before the programme: catching those up would pay every
 * past customer at once (a liability decision for the owner, brief PART S), so
 * those missions keep paying at the customer's next qualifying event, as they
 * always have. Badge-only missions are skipped (no ledger row marks them done).
 */
export class CatchUpMissionAwardsUseCase {
  static readonly KINDS = ['REFERRAL_COUNT'];
  static readonly PER_MISSION_LIMIT = 500;

  constructor(
    private readonly gamification: IGamificationLiveRepository,
    private readonly evaluate: { execute(input: { userId: string }): Promise<{ ok: true; awarded: Array<{ missionKey: string; points: number }> } | Fail> },
    /** The guarded issuance config: off, kill switch, or budget cap reached all read as "stop". */
    private readonly completion: Pick<ILoyaltyCompletionRepository, 'getProgrammeConfig'>,
  ) {}

  async execute(): Promise<{ candidates: number; awarded: number; skipped?: 'PROGRAMME_INACTIVE' }> {
    // Checked ONCE: per-candidate evaluation would re-read the guarded config
    // for every customer, and at the budget cap each read records a signal.
    const config = await this.completion.getProgrammeConfig();
    if (!config.enabled || config.killSwitch) return { candidates: 0, awarded: 0, skipped: 'PROGRAMME_INACTIVE' };
    const missions = (await this.gamification.listActiveMissions())
      .filter((m) => m.rewardPoints > 0 && CatchUpMissionAwardsUseCase.KINDS.includes(m.kind));
    const users = new Set<string>();
    for (const mission of missions) {
      for (const userId of await this.gamification.missionCatchUpCandidates(mission, CatchUpMissionAwardsUseCase.PER_MISSION_LIMIT)) {
        users.add(userId);
      }
    }
    let awarded = 0;
    for (const userId of users) {
      const result = await this.evaluate.execute({ userId }).catch(() => null);
      if (result?.ok) awarded += result.awarded.length;
    }
    return { candidates: users.size, awarded };
  }
}

/** Evaluate every ACTIVE mission for one user and award completions, once ever. */
export class EvaluateGamificationForUserUseCase {
  constructor(
    private readonly loyalty: ILoyaltyRepository,
    private readonly completion: ILoyaltyCompletionRepository,
    private readonly gamification: IGamificationLiveRepository,
    /** Tells the customer about a bonus that just landed. Never fails an award. */
    private readonly notify: (input: { userId: string; missionKey: string; missionTitle: string; points: number }) => Promise<unknown> = async () => undefined,
  ) {}

  async execute(input: { userId: string }): Promise<{ ok: true; awarded: Array<{ missionKey: string; points: number }> } | Fail> {
    const config = await this.completion.getProgrammeConfig();
    if (!config.enabled || config.killSwitch) return fail('PROGRAMME_DISABLED', 'Programme inactive.');
    const missions = await this.gamification.listActiveMissions();
    if (missions.length === 0) return { ok: true, awarded: [] };
    const account = await this.loyalty.getOrCreateAccount(input.userId);
    const awarded: Array<{ missionKey: string; points: number }> = [];
    for (const mission of missions) {
      const progress = await this.gamification.missionProgress(input.userId, mission, {
        streakWindowDays: config.streakWindowDays,
      });
      if (progress === null || progress < mission.threshold) continue;
      let newlyAwarded = false;
      if (mission.rewardPoints > 0) {
        try {
          const { replay } = await this.loyalty.append({
            accountId: account.id,
            type: 'adjustment',
            points: mission.rewardPoints,
            orderId: null,
            reason: `Mission complete: ${mission.title}`,
            idempotencyKey: `mission:${mission.key}:${input.userId}`, // once ever per user
            expiresAt: null,
            reversedEntryId: null,
            ruleCode: 'mission',
            ruleVersion: 1,
          });
          newlyAwarded = !replay;
        } catch (error) {
          if ((error as Error).message !== 'LOYALTY_IDEMPOTENCY_CONFLICT') throw error;
        }
      } else {
        // Badge-only missions: the badge uniqueness is the once-ever gate.
        newlyAwarded = true;
      }
      if (mission.badgeKey) await this.gamification.awardBadgeByKey(input.userId, mission.badgeKey);
      if (newlyAwarded && mission.rewardPoints > 0) {
        awarded.push({ missionKey: mission.key, points: mission.rewardPoints });
        await this.notify({ userId: input.userId, missionKey: mission.key, missionTitle: mission.title, points: mission.rewardPoints }).catch(() => undefined);
      }
    }
    return { ok: true, awarded };
  }
}

/** Record a referral at registration. Self-referral and rings are the fraud vectors. */
export class RecordReferralUseCase {
  constructor(
    private readonly completion: ILoyaltyCompletionRepository,
    private readonly referrals: ILoyaltyReferralRepository,
  ) {}

  async execute(input: { refereeUserId: string; code: string; source?: ReferralSource }): Promise<{ ok: true; status: 'recorded' } | Fail> {
    const config = await this.completion.getProgrammeConfig();
    if (!config.enabled || config.killSwitch) return fail('PROGRAMME_DISABLED', 'Programme inactive.');
    if (config.referralReferrerPoints === null) return fail('REFERRALS_OFF', 'Referral rewards are not configured.');
    // "gp 4k7-m2q" is GP4K7M2Q: a pasted or spoken code with a space used to be dropped without a word.
    const code = normaliseReferralCode(input.code);
    if (!code) return fail('CODE_NOT_FOUND', 'That referral code does not exist.');
    const referrer = await this.referrals.findReferrerByCode(code);
    if (!referrer) return fail('CODE_NOT_FOUND', 'That referral code does not exist.');
    if (referrer.userId === input.refereeUserId) return fail('SELF_REFERRAL', 'You cannot refer yourself.');
    const refereePhone = await this.referrals.userPhone(input.refereeUserId);
    if (refereePhone && referrer.phone && refereePhone === referrer.phone) {
      await this.completion.recordFraudSignal({
        accountId: null,
        userId: referrer.userId,
        signalType: 'REFERRAL_SAME_PHONE',
        details: { refereeUserId: input.refereeUserId },
      });
      return fail('SELF_REFERRAL', 'Referrer and referee share a phone number.');
    }
    // A code added after sign-up (another device, Google sign-up, forgot) is for a NEW customer only: once a first
    // order is delivered, there is nothing left to introduce.
    if ((await this.referrals.countDeliveredRetailOrders(input.refereeUserId)) > 0) {
      return fail('ALREADY_A_CUSTOMER', 'This account already has a delivered order.');
    }
    const outcome = await this.referrals.recordReferral({ code, referrerUserId: referrer.userId, refereeUserId: input.refereeUserId, source: input.source ?? 'typed' });
    if (outcome === 'duplicate') return fail('ALREADY_REFERRED', 'This account has already been referred.');
    return { ok: true, status: 'recorded' };
  }
}

/**
 * A referral qualifies when the REFEREE'S FIRST retail order is delivered and
 * paid — the brief's completion event. Both sides earn, once, through the
 * ledger; a referrer past the monthly cap is HELD with a fraud signal, not
 * silently paid.
 */
export class QualifyReferralOnDeliveryUseCase {
  static readonly MONTHLY_AWARD_CAP = 10;

  constructor(
    private readonly loyalty: ILoyaltyRepository,
    private readonly completion: ILoyaltyCompletionRepository,
    private readonly referrals: ILoyaltyReferralRepository,
    private readonly gamification: IGamificationLiveRepository,
    private readonly notify: (input: { userId: string; points: number; kind: 'referrer' | 'referee'; referralId: string }) => Promise<unknown>,
  ) {}

  async execute(input: { orderId: string; refereeUserId: string }): Promise<{ ok: true; status: 'awarded' | 'held' | 'none'; referrerUserId?: string } | Fail> {
    const config = await this.completion.getProgrammeConfig();
    if (!config.enabled || config.killSwitch) return fail('PROGRAMME_DISABLED', 'Programme inactive.');
    if (config.referralReferrerPoints === null || config.referralRefereePoints === null) {
      return { ok: true, status: 'none' };
    }
    const referral = await this.referrals.findPendingByReferee(input.refereeUserId);
    if (!referral) return { ok: true, status: 'none' };
    // A pending referral has never paid, and a code is accepted only before the friend's first delivery
    // (RecordReferral), so the first delivery that reaches here pays. It used to need the count to be EXACTLY 1: a
    // first delivery this was not run for (the order earned no points, a paused budget) left it pending for good.
    const delivered = await this.referrals.countDeliveredRetailOrders(input.refereeUserId);
    if (delivered < 1) return { ok: true, status: 'none' };
    const awardedThisMonth = await this.referrals.countAwardedForReferrer(referral.referrerUserId, 30);
    if (awardedThisMonth >= QualifyReferralOnDeliveryUseCase.MONTHLY_AWARD_CAP) {
      await this.completion.recordFraudSignal({
        accountId: null,
        userId: referral.referrerUserId,
        signalType: 'REFERRAL_MONTHLY_CAP',
        details: { referralId: referral.id, awardedThisMonth },
      });
      await this.referrals.markHeld?.(referral.id, 'MONTHLY_LIMIT', input.orderId);
      return { ok: true, status: 'held' };
    }
    // Registration refuses a phone already on an account, so the same-phone check at registration can hardly ever
    // fire: a second account on another SIM whose first order is delivered to the referrer's own phone paid both
    // sides. Held for a person (a family sharing one phone is possible), never paid automatically.
    if (this.referrals.orderUsesReferrerPhone && (await this.referrals.orderUsesReferrerPhone(input.orderId, referral.referrerUserId))) {
      await this.completion.recordFraudSignal({
        accountId: null,
        userId: referral.referrerUserId,
        signalType: 'REFERRAL_ORDER_TO_REFERRER_PHONE',
        details: { referralId: referral.id, orderId: input.orderId, refereeUserId: input.refereeUserId },
      });
      await this.referrals.markHeld?.(referral.id, 'ORDER_TO_REFERRER_PHONE', input.orderId);
      return { ok: true, status: 'held' };
    }
    return this.award(referral, input.refereeUserId, input.orderId, config, null);
  }

  /** Pays both sides, once (ledger idempotency keys), and tells them. Also the path a person's release takes. */
  async award(
    referral: { id: string; referrerUserId: string },
    refereeUserId: string,
    orderId: string,
    config: { referralReferrerPoints: number | null; referralRefereePoints: number | null },
    decidedBy: string | null,
  ): Promise<{ ok: true; status: 'awarded'; referrerUserId: string }> {
    const input = { refereeUserId, orderId };
    const referrerPoints = config.referralReferrerPoints ?? 0;
    const refereePoints = config.referralRefereePoints ?? 0;
    const referrerAccount = await this.loyalty.getOrCreateAccount(referral.referrerUserId);
    const refereeAccount = await this.loyalty.getOrCreateAccount(input.refereeUserId);
    const append = async (accountId: string, points: number, side: 'referrer' | 'referee') => {
      try {
        const { entry } = await this.loyalty.append({
          accountId,
          type: 'adjustment',
          points,
          orderId: null,
          reason: side === 'referrer' ? 'Referral reward: your friend received their first order' : 'Welcome reward: referred by a friend',
          idempotencyKey: `referral:${referral.id}:${side}`,
          expiresAt: null,
          reversedEntryId: null,
          ruleCode: 'referral',
          ruleVersion: 1,
        });
        return entry.id;
      } catch (error) {
        if ((error as Error).message === 'LOYALTY_IDEMPOTENCY_CONFLICT') return null;
        throw error;
      }
    };
    const referrerEntryId = await append(referrerAccount.id, referrerPoints, 'referrer');
    const refereeEntryId = await append(refereeAccount.id, refereePoints, 'referee');
    await this.referrals.markAwarded(referral.id, referrerEntryId ?? '', refereeEntryId ?? '', input.orderId, decidedBy);
    await this.gamification.awardBadgeByKey(referral.referrerUserId, 'referrer');
    await this.notify({ userId: referral.referrerUserId, points: referrerPoints, kind: 'referrer', referralId: referral.id }).catch(() => undefined);
    await this.notify({ userId: input.refereeUserId, points: refereePoints, kind: 'referee', referralId: referral.id }).catch(() => undefined);
    return { ok: true, status: 'awarded', referrerUserId: referral.referrerUserId };
  }
}

/**
 * A person decides a HELD referral (0202). Before, a held referral stayed 'pending' and the friend's next delivery
 * made it look like a second order, so it could never pay, and nothing let a person pay it either. Release pays both
 * sides on the order it was held on; refuse records the reason. Either way the decision is audited by the route.
 */
export class DecideHeldReferralUseCase {
  constructor(
    private readonly completion: ILoyaltyCompletionRepository,
    private readonly referrals: ILoyaltyReferralRepository,
    private readonly qualify: QualifyReferralOnDeliveryUseCase,
  ) {}

  async execute(input: { referralId: string; decision: 'release' | 'refuse'; actorId: string; reason?: string }): Promise<
    | { ok: true; status: 'awarded' | 'rejected'; referrerUserId: string }
    | Fail
  > {
    const r = this.referrals.findById ? await this.referrals.findById(input.referralId) : null;
    if (!r) return fail('NOT_FOUND', 'Referral not found.');
    if (r.status !== 'held') return fail('NOT_HELD', `This referral is ${r.status}, not waiting for a decision.`);
    if (input.decision === 'refuse') {
      const reason = (input.reason ?? '').trim();
      if (reason.length < 3) return fail('REASON_REQUIRED', 'Say why the referral is refused.');
      await this.referrals.markRejected(r.id, `REFUSED: ${reason}`, input.actorId);
      return { ok: true, status: 'rejected', referrerUserId: r.referrerUserId };
    }
    const config = await this.completion.getProgrammeConfig();
    if (!config.enabled || config.killSwitch) return fail('PROGRAMME_DISABLED', 'The programme is paused; nothing can be paid now.');
    if (config.referralReferrerPoints === null || config.referralRefereePoints === null) return fail('REFERRALS_OFF', 'Referral points are not set.');
    if (!r.qualifyingOrderId) return fail('NOT_FOUND', 'The order this referral was held on is not recorded.');
    return this.qualify.award(r, r.refereeUserId, r.qualifyingOrderId, config, input.actorId);
  }
}

/** Birthday points, once per user per calendar year, from the customer's own DOB. */
export interface IBirthdayUserSource {
  usersWithBirthdayOn(monthDay: { month: number; day: number }): Promise<Array<{ userId: string }>>;
}

export class AwardBirthdayPointsUseCase {
  constructor(
    private readonly loyalty: ILoyaltyRepository,
    private readonly completion: ILoyaltyCompletionRepository,
    private readonly users: IBirthdayUserSource,
  ) {}

  async execute(now = new Date()): Promise<{ awarded: number }> {
    const config = await this.completion.getProgrammeConfig();
    if (!config.enabled || config.killSwitch || config.birthdayPoints === null) return { awarded: 0 };
    // Kampala's calendar day (UTC+3, no daylight saving). The UTC day made a
    // sweep between 00:00 and 03:00 Kampala award YESTERDAY's birthdays.
    const kampala = new Date(now.getTime() + 3 * 3_600_000);
    const year = kampala.getUTCFullYear();
    const month = kampala.getUTCMonth() + 1;
    const day = kampala.getUTCDate();
    const celebrants = await this.users.usersWithBirthdayOn({ month, day });
    // 29 February birthdays are celebrated on 28 February in other years
    // (they never matched before). The yearly key keeps it to one award.
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    if (month === 2 && day === 28 && !leap) celebrants.push(...(await this.users.usersWithBirthdayOn({ month: 2, day: 29 })));
    let awarded = 0;
    for (const { userId } of celebrants) {
      const account = await this.loyalty.getOrCreateAccount(userId);
      try {
        const { replay } = await this.loyalty.append({
          accountId: account.id,
          type: 'adjustment',
          points: config.birthdayPoints,
          orderId: null,
          reason: 'Happy birthday from GoldPlus',
          idempotencyKey: `birthday:${userId}:${year}`, // once per (Kampala) year
          expiresAt: null,
          reversedEntryId: null,
          ruleCode: 'birthday',
          ruleVersion: 1,
        });
        if (!replay) awarded++;
      } catch (error) {
        if ((error as Error).message !== 'LOYALTY_IDEMPOTENCY_CONFLICT') throw error;
      }
    }
    return { awarded };
  }
}

/**
 * Counterfeit-report confirmation earn (brief PART J: "points and a support
 * pathway for a confirmed counterfeit report"). Fires only from the admin
 * confirmation action, only for an attributable (signed-in) reporter, once
 * per report — the report id is the idempotency scope.
 */
export class EarnForCounterfeitConfirmationUseCase {
  constructor(
    private readonly loyalty: ILoyaltyRepository,
    private readonly completion: ILoyaltyCompletionRepository,
    private readonly gamification: IGamificationLiveRepository,
  ) {}

  async execute(input: { reportId: string; reporterUserId: string }): Promise<{ ok: true; points: number; entryId: string } | Fail> {
    const config = await this.completion.getProgrammeConfig();
    if (!config.enabled || config.killSwitch) return fail('PROGRAMME_DISABLED', 'Programme inactive.');
    const rule = await this.completion.getActiveRule('counterfeit_report');
    if (!rule) return fail('RULE_INACTIVE', 'Counterfeit-report earning is not activated.');
    const account = await this.loyalty.getOrCreateAccount(input.reporterUserId);
    try {
      const { entry, replay } = await this.loyalty.append({
        accountId: account.id,
        type: 'adjustment',
        points: rule.rate,
        orderId: null,
        reason: `Confirmed counterfeit report (rule v${rule.version})`,
        idempotencyKey: `counterfeit:${input.reportId}`,
        expiresAt: null,
        reversedEntryId: null,
        ruleCode: 'counterfeit_report',
        ruleVersion: rule.version,
      });
      await this.gamification.awardBadgeByKey(input.reporterUserId, 'counterfeit_hunter');
      return { ok: true, points: replay ? 0 : entry.points, entryId: entry.id };
    } catch (error) {
      if ((error as Error).message === 'LOYALTY_IDEMPOTENCY_CONFLICT') {
        return fail('ALREADY_EARNED', 'This report has already earned points.');
      }
      throw error;
    }
  }
}

/** Phone-verification earn: 'phone_verification' rule, once per user, ever. */
export class EarnForPhoneVerificationUseCase {
  constructor(
    private readonly loyalty: ILoyaltyRepository,
    private readonly completion: ILoyaltyCompletionRepository,
    private readonly gamification: IGamificationLiveRepository,
  ) {}

  async execute(input: { userId: string }): Promise<{ ok: true; points: number } | Fail> {
    const config = await this.completion.getProgrammeConfig();
    if (!config.enabled || config.killSwitch) return fail('PROGRAMME_DISABLED', 'Programme inactive.');
    const rule = await this.completion.getActiveRule('phone_verification');
    if (!rule) return fail('RULE_INACTIVE', 'Phone-verification earning is not activated.');
    const account = await this.loyalty.getOrCreateAccount(input.userId);
    try {
      const { entry, replay } = await this.loyalty.append({
        accountId: account.id,
        type: 'adjustment',
        points: rule.rate,
        orderId: null,
        reason: `Phone number verified (rule v${rule.version})`,
        idempotencyKey: `phoneverify:${input.userId}`, // once per user, ever
        expiresAt: null,
        reversedEntryId: null,
        ruleCode: 'phone_verification',
        ruleVersion: rule.version,
      });
      await this.gamification.awardBadgeByKey(input.userId, 'verified_buyer');
      return { ok: true, points: replay ? 0 : entry.points };
    } catch (error) {
      if ((error as Error).message === 'LOYALTY_IDEMPOTENCY_CONFLICT') {
        return fail('ALREADY_EARNED', 'Phone verification has already earned points.');
      }
      throw error;
    }
  }
}
