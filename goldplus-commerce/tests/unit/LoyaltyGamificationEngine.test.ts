import { describe, expect, it, beforeEach } from 'vitest';
import {
  AwardBirthdayPointsUseCase,
  EarnForCounterfeitConfirmationUseCase,
  EarnForPhoneVerificationUseCase,
  EvaluateGamificationForUserUseCase,
  QualifyReferralOnDeliveryUseCase,
  RecordReferralUseCase,
  ActiveMission,
} from '../../apps/api/src/application/use-cases/loyalty/LoyaltyGamificationUseCases';
import { LoyaltyProgrammeConfig } from '../../apps/api/src/domain/loyalty/LoyaltyLedger';

/**
 * Gamification engine behaviour (0087 activation).
 *
 * These exercise the real use cases against in-memory fakes: the point of the
 * suite is that every award is idempotent, every anti-gaming rule actually
 * refuses, and every mechanic is OFF when its config value is unset.
 */

const BASE_CONFIG: LoyaltyProgrammeConfig = {
  enabled: true,
  earnRatePer1000Ugx: 10,
  expiryDays: 120,
  pointValueUgx: 20,
  redemptionMinPoints: 500,
  redemptionMaxShareBps: 5000,
  budgetCapPoints: 1_000_000,
  killSwitch: false,
  guestBackfillLookbackDays: 90,
  guestBackfillCapPoints: 5000,
  referralReferrerPoints: 200,
  referralRefereePoints: 100,
  birthdayPoints: 150,
  streakTargetOrders: 3,
  streakWindowDays: 90,
  streakRewardPoints: 300,
  chanceEnabled: false,
  termsVersion: 'v1',
};

/** Append-only ledger fake: a duplicate idempotency key REPLAYS, never doubles. */
class FakeLedger {
  entries: Array<{ id: string; accountId: string; points: number; idempotencyKey: string; type: string; ruleCode?: string | null }> = [];
  private seq = 0;

  async getOrCreateAccount(userId: string) {
    return { id: `acct-${userId}`, userId };
  }

  async append(input: any) {
    const existing = this.entries.find((e) => e.idempotencyKey === input.idempotencyKey);
    if (existing) return { entry: existing, replay: true };
    const entry = {
      id: `e${++this.seq}`,
      accountId: input.accountId,
      points: input.points,
      idempotencyKey: input.idempotencyKey,
      type: input.type,
      ruleCode: input.ruleCode ?? null,
      createdAt: new Date(),
    };
    this.entries.push(entry as any);
    return { entry, replay: false };
  }

  async listEntries(accountId: string) {
    return this.entries.filter((e) => e.accountId === accountId) as any;
  }

  pointsFor(userId: string) {
    return this.entries.filter((e) => e.accountId === `acct-${userId}`).reduce((s, e) => s + e.points, 0);
  }
}

class FakeCompletion {
  config: LoyaltyProgrammeConfig = { ...BASE_CONFIG };
  rules: Record<string, { rate: number; version: number } | null> = {
    verification_scan: { rate: 25, version: 1 },
    counterfeit_report: { rate: 250, version: 1 },
    phone_verification: { rate: 100, version: 1 },
  };
  fraudSignals: Array<{ signalType: string; userId?: string | null }> = [];

  async getProgrammeConfig() {
    return this.config;
  }
  async getActiveRule(code: string) {
    const r = this.rules[code];
    return r ? { id: code, ruleCode: code, version: r.version, earnBasis: 'event', rate: r.rate, active: true } : null;
  }
  async recordFraudSignal(input: any) {
    this.fraudSignals.push(input);
  }
  async listAccountIds() {
    return [];
  }
}

class FakeGamification {
  missions: ActiveMission[] = [];
  progress = new Map<string, number | null>();
  badges: Array<{ userId: string; badgeKey: string }> = [];

  async listActiveMissions() {
    return this.missions;
  }
  async missionProgress(userId: string, mission: ActiveMission) {
    const v = this.progress.get(`${userId}:${mission.key}`);
    return v === undefined ? null : v;
  }
  async awardBadgeByKey(userId: string, badgeKey: string) {
    if (this.badges.some((b) => b.userId === userId && b.badgeKey === badgeKey)) return false;
    this.badges.push({ userId, badgeKey });
    return true;
  }
}

class FakeReferrals {
  codes = new Map<string, string>(); // userId -> code
  users = new Map<string, { phone: string | null }>();
  rows: Array<{ id: string; code: string; referrerUserId: string; refereeUserId: string; status: string }> = [];
  deliveredCounts = new Map<string, number>();
  private seq = 0;

  async getOrCreateCode(userId: string) {
    if (!this.codes.has(userId)) this.codes.set(userId, `GPCODE${++this.seq}`);
    return this.codes.get(userId)!;
  }
  async findReferrerByCode(code: string) {
    for (const [userId, c] of this.codes) {
      if (c === code) return { userId, phone: this.users.get(userId)?.phone ?? null };
    }
    return null;
  }
  async userPhone(userId: string) {
    return this.users.get(userId)?.phone ?? null;
  }
  async recordReferral(input: { code: string; referrerUserId: string; refereeUserId: string }) {
    if (this.rows.some((r) => r.refereeUserId === input.refereeUserId)) return 'duplicate' as const;
    this.rows.push({ id: `r${++this.seq}`, ...input, status: 'pending' });
    return 'recorded' as const;
  }
  async findPendingByReferee(refereeUserId: string) {
    const row = this.rows.find((r) => r.refereeUserId === refereeUserId && r.status === 'pending');
    return row ? { id: row.id, code: row.code, referrerUserId: row.referrerUserId } : null;
  }
  async markAwarded(id: string) {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.status = 'awarded';
  }
  async markRejected(id: string) {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.status = 'rejected';
  }
  async countAwardedForReferrer(referrerUserId: string) {
    return this.rows.filter((r) => r.referrerUserId === referrerUserId && r.status === 'awarded').length;
  }
  async countDeliveredRetailOrders(userId: string) {
    return this.deliveredCounts.get(userId) ?? 0;
  }
  async listForReferrer(referrerUserId: string) {
    return this.rows.filter((r) => r.referrerUserId === referrerUserId).map((r) => ({ status: r.status, createdAt: new Date() }));
  }
}

let ledger: FakeLedger;
let completion: FakeCompletion;
let gamification: FakeGamification;
let referrals: FakeReferrals;

beforeEach(() => {
  ledger = new FakeLedger();
  completion = new FakeCompletion();
  gamification = new FakeGamification();
  referrals = new FakeReferrals();
});

describe('mission evaluation and badge awards', () => {
  const mission: ActiveMission = { id: 'm1', key: 'five_deliveries', title: 'Five Deliveries', kind: 'PURCHASE_COUNT', threshold: 5, rewardPoints: 250, badgeKey: 'loyal_customer' };

  it('awards points and the linked badge when the threshold is met', async () => {
    gamification.missions = [mission];
    gamification.progress.set('u1:five_deliveries', 5);
    const uc = new EvaluateGamificationForUserUseCase(ledger as any, completion as any, gamification as any);
    const result = await uc.execute({ userId: 'u1' });
    expect(result).toMatchObject({ ok: true });
    expect(ledger.pointsFor('u1')).toBe(250);
    expect(gamification.badges).toContainEqual({ userId: 'u1', badgeKey: 'loyal_customer' });
  });

  it('never double-awards when evaluated repeatedly — the idempotency key is the once-ever gate', async () => {
    gamification.missions = [mission];
    gamification.progress.set('u1:five_deliveries', 9);
    const uc = new EvaluateGamificationForUserUseCase(ledger as any, completion as any, gamification as any);
    await uc.execute({ userId: 'u1' });
    await uc.execute({ userId: 'u1' });
    await uc.execute({ userId: 'u1' });
    expect(ledger.pointsFor('u1')).toBe(250);
    expect(ledger.entries.filter((e) => e.idempotencyKey === 'mission:five_deliveries:u1')).toHaveLength(1);
  });

  it('awards nothing below the threshold', async () => {
    gamification.missions = [mission];
    gamification.progress.set('u1:five_deliveries', 4);
    const uc = new EvaluateGamificationForUserUseCase(ledger as any, completion as any, gamification as any);
    await uc.execute({ userId: 'u1' });
    expect(ledger.entries).toHaveLength(0);
  });

  it('awards nothing when progress is unattributable (null), never treats it as zero or complete', async () => {
    gamification.missions = [{ ...mission, kind: 'REVIEW_COUNT', key: 'reviews', threshold: 0 }];
    const uc = new EvaluateGamificationForUserUseCase(ledger as any, completion as any, gamification as any);
    await uc.execute({ userId: 'u1' });
    expect(ledger.entries).toHaveLength(0);
  });

  it('the kill switch halts every award without a deploy', async () => {
    gamification.missions = [mission];
    gamification.progress.set('u1:five_deliveries', 10);
    completion.config = { ...BASE_CONFIG, killSwitch: true };
    const uc = new EvaluateGamificationForUserUseCase(ledger as any, completion as any, gamification as any);
    expect(await uc.execute({ userId: 'u1' })).toMatchObject({ ok: false, code: 'PROGRAMME_DISABLED' });
    expect(ledger.entries).toHaveLength(0);
  });
});

describe('referrals', () => {
  it('records a pending referral and pays nothing at signup', async () => {
    await referrals.getOrCreateCode('referrer');
    const code = await referrals.getOrCreateCode('referrer');
    const uc = new RecordReferralUseCase(completion as any, referrals as any);
    expect(await uc.execute({ refereeUserId: 'newbie', code })).toMatchObject({ ok: true, status: 'recorded' });
    expect(ledger.entries).toHaveLength(0);
  });

  it('refuses self-referral', async () => {
    const code = await referrals.getOrCreateCode('u1');
    const uc = new RecordReferralUseCase(completion as any, referrals as any);
    expect(await uc.execute({ refereeUserId: 'u1', code })).toMatchObject({ ok: false, code: 'SELF_REFERRAL' });
  });

  it('refuses a referral where both accounts share a phone, and raises a fraud signal', async () => {
    referrals.users.set('referrer', { phone: '+256770000001' });
    referrals.users.set('sock', { phone: '+256770000001' });
    const code = await referrals.getOrCreateCode('referrer');
    const uc = new RecordReferralUseCase(completion as any, referrals as any);
    expect(await uc.execute({ refereeUserId: 'sock', code })).toMatchObject({ ok: false, code: 'SELF_REFERRAL' });
    expect(completion.fraudSignals.map((s) => s.signalType)).toContain('REFERRAL_SAME_PHONE');
  });

  it('refuses a second referral of the same account, ever', async () => {
    const code1 = await referrals.getOrCreateCode('r1');
    const code2 = await referrals.getOrCreateCode('r2');
    const uc = new RecordReferralUseCase(completion as any, referrals as any);
    await uc.execute({ refereeUserId: 'newbie', code: code1 });
    expect(await uc.execute({ refereeUserId: 'newbie', code: code2 })).toMatchObject({ ok: false, code: 'ALREADY_REFERRED' });
  });

  it('is OFF when the referral value is unset — unset means unset', async () => {
    completion.config = { ...BASE_CONFIG, referralReferrerPoints: null };
    const code = await referrals.getOrCreateCode('r1');
    const uc = new RecordReferralUseCase(completion as any, referrals as any);
    expect(await uc.execute({ refereeUserId: 'newbie', code })).toMatchObject({ ok: false, code: 'REFERRALS_OFF' });
  });

  it('pays both sides only on the referee FIRST delivered order', async () => {
    const code = await referrals.getOrCreateCode('r1');
    await new RecordReferralUseCase(completion as any, referrals as any).execute({ refereeUserId: 'newbie', code });
    referrals.deliveredCounts.set('newbie', 1);
    const uc = new QualifyReferralOnDeliveryUseCase(ledger as any, completion as any, referrals as any, gamification as any, async () => undefined);
    expect(await uc.execute({ orderId: 'o1', refereeUserId: 'newbie' })).toMatchObject({ ok: true, status: 'awarded' });
    expect(ledger.pointsFor('r1')).toBe(200);
    expect(ledger.pointsFor('newbie')).toBe(100);
    expect(gamification.badges).toContainEqual({ userId: 'r1', badgeKey: 'referrer' });
  });

  it('pays nothing on the referee SECOND delivery', async () => {
    const code = await referrals.getOrCreateCode('r1');
    await new RecordReferralUseCase(completion as any, referrals as any).execute({ refereeUserId: 'newbie', code });
    referrals.deliveredCounts.set('newbie', 2);
    const uc = new QualifyReferralOnDeliveryUseCase(ledger as any, completion as any, referrals as any, gamification as any, async () => undefined);
    expect(await uc.execute({ orderId: 'o2', refereeUserId: 'newbie' })).toMatchObject({ ok: true, status: 'none' });
    expect(ledger.entries).toHaveLength(0);
  });

  it('holds a referrer past the monthly cap and raises a fraud signal instead of paying', async () => {
    for (let i = 0; i < QualifyReferralOnDeliveryUseCase.MONTHLY_AWARD_CAP; i++) {
      referrals.rows.push({ id: `old${i}`, code: 'X', referrerUserId: 'ring', refereeUserId: `victim${i}`, status: 'awarded' });
    }
    const code = await referrals.getOrCreateCode('ring');
    await new RecordReferralUseCase(completion as any, referrals as any).execute({ refereeUserId: 'fresh', code });
    referrals.deliveredCounts.set('fresh', 1);
    const uc = new QualifyReferralOnDeliveryUseCase(ledger as any, completion as any, referrals as any, gamification as any, async () => undefined);
    expect(await uc.execute({ orderId: 'o1', refereeUserId: 'fresh' })).toMatchObject({ ok: true, status: 'held' });
    expect(ledger.entries).toHaveLength(0);
    expect(completion.fraudSignals.map((s) => s.signalType)).toContain('REFERRAL_MONTHLY_CAP');
  });
});

describe('birthday points', () => {
  const source = (userIds: string[]) => ({ usersWithBirthdayOn: async () => userIds.map((userId) => ({ userId })) });

  it('awards once per user per calendar year however often the sweep runs', async () => {
    const uc = new AwardBirthdayPointsUseCase(ledger as any, completion as any, source(['u1']) as any);
    const day = new Date('2026-08-05T06:00:00Z');
    expect(await uc.execute(day)).toEqual({ awarded: 1 });
    expect(await uc.execute(day)).toEqual({ awarded: 0 });
    expect(await uc.execute(new Date('2026-08-05T23:00:00Z'))).toEqual({ awarded: 0 });
    expect(ledger.pointsFor('u1')).toBe(150);
  });

  it('awards again the following year', async () => {
    const uc = new AwardBirthdayPointsUseCase(ledger as any, completion as any, source(['u1']) as any);
    await uc.execute(new Date('2026-08-05T06:00:00Z'));
    await uc.execute(new Date('2027-08-05T06:00:00Z'));
    expect(ledger.pointsFor('u1')).toBe(300);
  });

  it('is OFF when birthday points are unset', async () => {
    completion.config = { ...BASE_CONFIG, birthdayPoints: null };
    const uc = new AwardBirthdayPointsUseCase(ledger as any, completion as any, source(['u1']) as any);
    expect(await uc.execute(new Date('2026-08-05T06:00:00Z'))).toEqual({ awarded: 0 });
    expect(ledger.entries).toHaveLength(0);
  });
});

describe('counterfeit confirmation earning', () => {
  it('awards the rule rate once per report and grants the hunter badge', async () => {
    const uc = new EarnForCounterfeitConfirmationUseCase(ledger as any, completion as any, gamification as any);
    const first = await uc.execute({ reportId: 'rep1', reporterUserId: 'u1' });
    expect(first).toMatchObject({ ok: true, points: 250 });
    expect(gamification.badges).toContainEqual({ userId: 'u1', badgeKey: 'counterfeit_hunter' });
    const second = await uc.execute({ reportId: 'rep1', reporterUserId: 'u1' });
    expect(second).toMatchObject({ ok: true, points: 0 });
    expect(ledger.pointsFor('u1')).toBe(250);
  });

  it('refuses when the rule is inactive — the engine exists with zero unapproved liability', async () => {
    completion.rules.counterfeit_report = null;
    const uc = new EarnForCounterfeitConfirmationUseCase(ledger as any, completion as any, gamification as any);
    expect(await uc.execute({ reportId: 'rep1', reporterUserId: 'u1' })).toMatchObject({ ok: false, code: 'RULE_INACTIVE' });
    expect(ledger.entries).toHaveLength(0);
  });
});

describe('phone verification earning', () => {
  it('awards once per user ever, across repeated verifications', async () => {
    const uc = new EarnForPhoneVerificationUseCase(ledger as any, completion as any, gamification as any);
    expect(await uc.execute({ userId: 'u1' })).toMatchObject({ ok: true, points: 100 });
    expect(await uc.execute({ userId: 'u1' })).toMatchObject({ ok: true, points: 0 });
    expect(ledger.pointsFor('u1')).toBe(100);
    expect(gamification.badges).toContainEqual({ userId: 'u1', badgeKey: 'verified_buyer' });
  });

  it('refuses while the programme is disabled', async () => {
    completion.config = { ...BASE_CONFIG, enabled: false };
    const uc = new EarnForPhoneVerificationUseCase(ledger as any, completion as any, gamification as any);
    expect(await uc.execute({ userId: 'u1' })).toMatchObject({ ok: false, code: 'PROGRAMME_DISABLED' });
  });
});
