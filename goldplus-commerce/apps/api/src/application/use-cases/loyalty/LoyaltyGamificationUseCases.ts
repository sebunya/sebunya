import { ILoyaltyRepository } from '../../ports/ILoyaltyRepository';
import { ILoyaltyCompletionRepository } from '../../ports/ILoyaltyCompletion';

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
  /** True when newly awarded; false when already held or badge unknown. */
  awardBadgeByKey(userId: string, badgeKey: string): Promise<boolean>;
}

export interface ILoyaltyReferralRepository {
  getOrCreateCode(userId: string): Promise<string>;
  findReferrerByCode(code: string): Promise<{ userId: string; phone: string | null } | null>;
  userPhone(userId: string): Promise<string | null>;
  recordReferral(input: { code: string; referrerUserId: string; refereeUserId: string }): Promise<'recorded' | 'duplicate'>;
  findPendingByReferee(refereeUserId: string): Promise<{ id: string; code: string; referrerUserId: string } | null>;
  markAwarded(id: string, referrerEntryId: string, refereeEntryId: string, qualifyingOrderId: string): Promise<void>;
  markRejected(id: string, reason: string): Promise<void>;
  countAwardedForReferrer(referrerUserId: string, sinceDays: number): Promise<number>;
  countDeliveredRetailOrders(userId: string): Promise<number>;
  listForReferrer(referrerUserId: string): Promise<Array<{ status: string; createdAt: Date }>>;
}

/** Evaluate every ACTIVE mission for one user and award completions, once ever. */
export class EvaluateGamificationForUserUseCase {
  constructor(
    private readonly loyalty: ILoyaltyRepository,
    private readonly completion: ILoyaltyCompletionRepository,
    private readonly gamification: IGamificationLiveRepository,
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
      if (newlyAwarded && mission.rewardPoints > 0) awarded.push({ missionKey: mission.key, points: mission.rewardPoints });
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

  async execute(input: { refereeUserId: string; code: string }): Promise<{ ok: true; status: 'recorded' } | Fail> {
    const config = await this.completion.getProgrammeConfig();
    if (!config.enabled || config.killSwitch) return fail('PROGRAMME_DISABLED', 'Programme inactive.');
    if (config.referralReferrerPoints === null) return fail('REFERRALS_OFF', 'Referral rewards are not configured.');
    const code = input.code.trim().toUpperCase();
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
    const outcome = await this.referrals.recordReferral({ code, referrerUserId: referrer.userId, refereeUserId: input.refereeUserId });
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
    private readonly notify: (input: { userId: string; points: number; kind: 'referrer' | 'referee' }) => Promise<unknown>,
  ) {}

  async execute(input: { orderId: string; refereeUserId: string }): Promise<{ ok: true; status: 'awarded' | 'held' | 'none' } | Fail> {
    const config = await this.completion.getProgrammeConfig();
    if (!config.enabled || config.killSwitch) return fail('PROGRAMME_DISABLED', 'Programme inactive.');
    if (config.referralReferrerPoints === null || config.referralRefereePoints === null) {
      return { ok: true, status: 'none' };
    }
    const referral = await this.referrals.findPendingByReferee(input.refereeUserId);
    if (!referral) return { ok: true, status: 'none' };
    // First delivered retail order only — the count includes the one that just landed.
    const delivered = await this.referrals.countDeliveredRetailOrders(input.refereeUserId);
    if (delivered !== 1) return { ok: true, status: 'none' };
    const awardedThisMonth = await this.referrals.countAwardedForReferrer(referral.referrerUserId, 30);
    if (awardedThisMonth >= QualifyReferralOnDeliveryUseCase.MONTHLY_AWARD_CAP) {
      await this.completion.recordFraudSignal({
        accountId: null,
        userId: referral.referrerUserId,
        signalType: 'REFERRAL_MONTHLY_CAP',
        details: { referralId: referral.id, awardedThisMonth },
      });
      return { ok: true, status: 'held' };
    }
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
    const referrerEntryId = await append(referrerAccount.id, config.referralReferrerPoints, 'referrer');
    const refereeEntryId = await append(refereeAccount.id, config.referralRefereePoints, 'referee');
    await this.referrals.markAwarded(referral.id, referrerEntryId ?? '', refereeEntryId ?? '', input.orderId);
    await this.gamification.awardBadgeByKey(referral.referrerUserId, 'referrer');
    await this.notify({ userId: referral.referrerUserId, points: config.referralReferrerPoints, kind: 'referrer' }).catch(() => undefined);
    await this.notify({ userId: input.refereeUserId, points: config.referralRefereePoints, kind: 'referee' }).catch(() => undefined);
    return { ok: true, status: 'awarded' };
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
    const celebrants = await this.users.usersWithBirthdayOn({ month: now.getUTCMonth() + 1, day: now.getUTCDate() });
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
          idempotencyKey: `birthday:${userId}:${now.getUTCFullYear()}`, // once per year
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
