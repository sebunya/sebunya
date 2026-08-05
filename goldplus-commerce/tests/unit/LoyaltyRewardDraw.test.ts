import { describe, expect, it, beforeEach } from 'vitest';
import {
  DrawPrize,
  availablePrizes,
  canGrantToken,
  isPrizeAvailable,
  maxPrizePoints,
  prizeSnapshot,
  publishedOdds,
  selectPrize,
  tokenExpiryFrom,
  totalWeight,
} from '../../apps/api/src/domain/loyalty/RewardDraw';
import {
  GrantDrawTokenUseCase,
  PlayDrawTokenUseCase,
} from '../../apps/api/src/application/use-cases/loyalty/LoyaltyDrawUseCases';
import { LoyaltyProgrammeConfig } from '../../apps/api/src/domain/loyalty/LoyaltyLedger';

/**
 * Reward draw (0088). The properties under test are the ones that make a
 * chance mechanic defensible: no losing outcome, published odds that match the
 * selection weights, one prize per card under concurrency, a card that is
 * never lost to a server error, and a budget that cannot strand a valid card.
 */

const prize = (over: Partial<DrawPrize> & { id: string; weight: number; pointsAwarded: number }): DrawPrize => ({
  label: `${over.pointsAwarded} points`,
  maxAwards: null,
  awardsMade: 0,
  displayOrder: 0,
  ...over,
});

const PRIZES: DrawPrize[] = [
  prize({ id: 'p25', pointsAwarded: 25, weight: 6000, displayOrder: 1 }),
  prize({ id: 'p50', pointsAwarded: 50, weight: 2500, displayOrder: 2 }),
  prize({ id: 'p100', pointsAwarded: 100, weight: 1200, displayOrder: 3 }),
  prize({ id: 'p250', pointsAwarded: 250, weight: 250, displayOrder: 4 }),
  prize({ id: 'p1000', pointsAwarded: 1000, weight: 50, maxAwards: 200, displayOrder: 5 }),
];

const CAMPAIGN = {
  id: 'c1',
  code: 'delivery_scratch_v1',
  active: true,
  startsAt: null,
  endsAt: null,
  budgetCapPoints: 200_000,
  pointsAwarded: 0,
  tokenExpiryDays: 30,
};

describe('prize selection is exact and fair', () => {
  it('maps every roll in range to the correct weight band', () => {
    // Bands: 0-5999 → p25, 6000-8499 → p50, 8500-9699 → p100,
    //        9700-9949 → p250, 9950-9999 → p1000
    expect(selectPrize(PRIZES, 0)?.id).toBe('p25');
    expect(selectPrize(PRIZES, 5999)?.id).toBe('p25');
    expect(selectPrize(PRIZES, 6000)?.id).toBe('p50');
    expect(selectPrize(PRIZES, 8499)?.id).toBe('p50');
    expect(selectPrize(PRIZES, 8500)?.id).toBe('p100');
    expect(selectPrize(PRIZES, 9699)?.id).toBe('p100');
    expect(selectPrize(PRIZES, 9700)?.id).toBe('p250');
    expect(selectPrize(PRIZES, 9949)?.id).toBe('p250');
    expect(selectPrize(PRIZES, 9950)?.id).toBe('p1000');
    expect(selectPrize(PRIZES, 9999)?.id).toBe('p1000');
  });

  it('never returns a losing outcome — every reachable prize awards points', () => {
    const total = totalWeight(PRIZES);
    for (let roll = 0; roll < total; roll += 97) {
      const won = selectPrize(PRIZES, roll);
      expect(won).not.toBeNull();
      expect(won!.pointsAwarded).toBeGreaterThan(0);
    }
  });

  it('refuses a roll outside the weight range rather than silently biasing', () => {
    expect(() => selectPrize(PRIZES, totalWeight(PRIZES))).toThrow('DRAW_ROLL_OUT_OF_RANGE');
    expect(() => selectPrize(PRIZES, -1)).toThrow('DRAW_ROLL_OUT_OF_RANGE');
    expect(() => selectPrize(PRIZES, 1.5)).toThrow('DRAW_ROLL_OUT_OF_RANGE');
  });

  it('produces the declared distribution across the whole roll space', () => {
    const counts = new Map<string, number>();
    const total = totalWeight(PRIZES);
    for (let roll = 0; roll < total; roll++) {
      const id = selectPrize(PRIZES, roll)!.id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    // Exhaustive over every possible roll: each prize is won exactly as often
    // as its weight says it should be.
    for (const p of PRIZES) expect(counts.get(p.id)).toBe(p.weight);
  });

  it('excludes a sold-out prize and redistributes its odds over the rest', () => {
    const exhausted = PRIZES.map((p) => (p.id === 'p1000' ? { ...p, awardsMade: 200 } : p));
    expect(isPrizeAvailable(exhausted.find((p) => p.id === 'p1000')!)).toBe(false);
    expect(availablePrizes(exhausted).map((p) => p.id)).not.toContain('p1000');
    const total = totalWeight(availablePrizes(exhausted));
    for (let roll = 0; roll < total; roll++) {
      expect(selectPrize(exhausted, roll)!.id).not.toBe('p1000');
    }
  });
});

describe('published odds match the mechanic', () => {
  it('sums to 100% across available prizes', () => {
    const sum = publishedOdds(PRIZES).reduce((s, o) => s + o.oddsBps, 0);
    expect(sum).toBe(10_000);
  });

  it('reports a sold-out tier as sold out with zero odds, not as a live chance', () => {
    const exhausted = PRIZES.map((p) => (p.id === 'p1000' ? { ...p, awardsMade: 200 } : p));
    const odds = publishedOdds(exhausted);
    const top = odds.find((o) => o.prizeId === 'p1000')!;
    expect(top.soldOut).toBe(true);
    expect(top.oddsBps).toBe(0);
    expect(odds.filter((o) => !o.soldOut).reduce((s, o) => s + o.oddsBps, 0)).toBe(10_000);
  });

  it('snapshots the odds table so a later weight edit cannot rewrite history', () => {
    const snap = prizeSnapshot(PRIZES);
    const edited = PRIZES.map((p) => (p.id === 'p1000' ? { ...p, weight: 1 } : p));
    expect(prizeSnapshot(edited)).not.toEqual(snap);
    expect(snap.totalWeight).toBe(10_000);
  });
});

describe('token granting protects the budget without stranding a card', () => {
  const now = new Date('2026-08-05T00:00:00Z');

  it('grants while the worst case still fits the budget', () => {
    expect(canGrantToken({ campaign: CAMPAIGN, prizes: PRIZES, outstandingTokens: 0, now })).toEqual({ ok: true });
  });

  it('stops granting BEFORE outstanding cards could exceed the cap', () => {
    // Max prize 1,000 × (199 outstanding + 1) = 200,000 = exactly the cap → still fine.
    expect(canGrantToken({ campaign: CAMPAIGN, prizes: PRIZES, outstandingTokens: 199, now })).toEqual({ ok: true });
    // One more would exceed it.
    expect(canGrantToken({ campaign: CAMPAIGN, prizes: PRIZES, outstandingTokens: 200, now })).toMatchObject({
      ok: false,
      reason: 'BUDGET_EXHAUSTED',
    });
  });

  it('accounts for points already awarded', () => {
    const spent = { ...CAMPAIGN, pointsAwarded: 199_500 };
    expect(canGrantToken({ campaign: spent, prizes: PRIZES, outstandingTokens: 0, now })).toMatchObject({
      ok: false,
      reason: 'BUDGET_EXHAUSTED',
    });
  });

  it('refuses when the campaign is inactive, unstarted or ended', () => {
    expect(canGrantToken({ campaign: { ...CAMPAIGN, active: false }, prizes: PRIZES, outstandingTokens: 0, now }))
      .toMatchObject({ ok: false, reason: 'CAMPAIGN_INACTIVE' });
    expect(canGrantToken({ campaign: { ...CAMPAIGN, startsAt: new Date('2026-09-01') }, prizes: PRIZES, outstandingTokens: 0, now }))
      .toMatchObject({ ok: false, reason: 'CAMPAIGN_NOT_STARTED' });
    expect(canGrantToken({ campaign: { ...CAMPAIGN, endsAt: new Date('2026-08-01') }, prizes: PRIZES, outstandingTokens: 0, now }))
      .toMatchObject({ ok: false, reason: 'CAMPAIGN_ENDED' });
  });

  it('refuses when every prize is exhausted rather than issuing a card that cannot pay', () => {
    const allGone = PRIZES.map((p) => ({ ...p, maxAwards: 1, awardsMade: 1 }));
    expect(canGrantToken({ campaign: CAMPAIGN, prizes: allGone, outstandingTokens: 0, now })).toMatchObject({
      ok: false,
      reason: 'NO_PRIZES_AVAILABLE',
    });
  });

  it('allows 25 cards in flight at the live 25,000-point budget, and stops at 26', () => {
    // Rob's UGX 500,000 cap / 20 UGX per point = 25,000 points. With a
    // 1,000-point top prize the pessimistic guard permits 25 unplayed cards at
    // once. This is the documented throughput consequence of guaranteeing that
    // every issued card can be paid — pinned so a budget change surfaces it.
    const live = { ...CAMPAIGN, budgetCapPoints: 25_000 };
    expect(canGrantToken({ campaign: live, prizes: PRIZES, outstandingTokens: 24, now })).toEqual({ ok: true });
    expect(canGrantToken({ campaign: live, prizes: PRIZES, outstandingTokens: 25, now })).toMatchObject({
      ok: false,
      reason: 'BUDGET_EXHAUSTED',
    });
    // Played cards stop being outstanding, so throughput recovers as they are
    // used: with 12,000 already awarded and nothing in flight, granting resumes.
    expect(canGrantToken({ campaign: { ...live, pointsAwarded: 12_000 }, prizes: PRIZES, outstandingTokens: 0, now })).toEqual({ ok: true });
  });

  it('dates the card from the campaign expiry window', () => {
    expect(tokenExpiryFrom(CAMPAIGN, now).toISOString()).toBe('2026-09-04T00:00:00.000Z');
    expect(maxPrizePoints(PRIZES)).toBe(1000);
  });
});

/* ── Use-case level: single use, ledger backing, gating ───────────────────── */

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
  chanceEnabled: true,
  termsVersion: 'v1',
};

class FakeLedger {
  entries: Array<{ id: string; accountId: string; points: number; idempotencyKey: string }> = [];
  private seq = 0;
  failNext = false;
  async getOrCreateAccount(userId: string) {
    return { id: `acct-${userId}`, userId };
  }
  async append(input: any) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('LEDGER_DOWN');
    }
    const existing = this.entries.find((e) => e.idempotencyKey === input.idempotencyKey);
    if (existing) return { entry: existing, replay: true };
    const entry = { id: `e${++this.seq}`, accountId: input.accountId, points: input.points, idempotencyKey: input.idempotencyKey };
    this.entries.push(entry);
    return { entry, replay: false };
  }
  pointsFor(userId: string) {
    return this.entries.filter((e) => e.accountId === `acct-${userId}`).reduce((s, e) => s + e.points, 0);
  }
}

class FakeCompletion {
  config: LoyaltyProgrammeConfig = { ...BASE_CONFIG };
  async getProgrammeConfig() {
    return this.config;
  }
}

class FakeDraws {
  campaign = { ...CAMPAIGN };
  prizes: DrawPrize[] = PRIZES.map((p) => ({ ...p }));
  tokens = new Map<string, { id: string; campaignId: string; userId: string; status: string; expiresAt: Date; createdAt: Date }>();
  results = new Map<string, { pointsAwarded: number; prizeId: string }>();
  granted: string[] = [];
  private seq = 0;

  async findActiveCampaignByTrigger() {
    return this.campaign.active ? this.campaign : null;
  }
  async findCampaignById() {
    return this.campaign;
  }
  async listPrizes() {
    return this.prizes;
  }
  async countOutstandingTokens() {
    return [...this.tokens.values()].filter((t) => t.status === 'available').length;
  }
  async grantToken(input: any) {
    const key = `${input.campaignId}:${input.sourceType}:${input.sourceId}`;
    if (this.granted.includes(key)) return null; // the unique index, in memory
    this.granted.push(key);
    const token = {
      id: `t${++this.seq}`,
      campaignId: input.campaignId,
      userId: input.userId,
      status: 'available',
      expiresAt: input.expiresAt,
      createdAt: new Date(),
    };
    this.tokens.set(token.id, token);
    return token;
  }
  async listAvailableTokens(userId: string) {
    return [...this.tokens.values()].filter((t) => t.userId === userId && t.status === 'available');
  }
  async findToken(tokenId: string) {
    return this.tokens.get(tokenId) ?? null;
  }
  /** Conditional update: only one caller can move available → played. */
  async claimToken(tokenId: string, userId: string) {
    const token = this.tokens.get(tokenId);
    if (!token || token.userId !== userId || token.status !== 'available') return null;
    token.status = 'played';
    return token;
  }
  async releaseToken(tokenId: string) {
    const token = this.tokens.get(tokenId);
    if (token && token.status === 'played') token.status = 'available';
  }
  async recordResult(input: any) {
    if (!this.results.has(input.tokenId)) {
      this.results.set(input.tokenId, { pointsAwarded: input.pointsAwarded, prizeId: input.prizeId });
    }
  }
  async incrementPrizeAward(prizeId: string) {
    const p = this.prizes.find((x) => x.id === prizeId);
    if (p) p.awardsMade += 1;
  }
  async incrementCampaignTotals(_id: string, points: number) {
    this.campaign.pointsAwarded += points;
  }
  async findResultByToken(tokenId: string) {
    return this.results.get(tokenId) ?? null;
  }
  async expireTokensDueBefore() {
    return 0;
  }
}

let ledger: FakeLedger;
let completion: FakeCompletion;
let draws: FakeDraws;

beforeEach(() => {
  ledger = new FakeLedger();
  completion = new FakeCompletion();
  draws = new FakeDraws();
});

const grantUc = () => new GrantDrawTokenUseCase(completion as any, draws as any, ledger as any);
const playUc = (roll: number) =>
  new PlayDrawTokenUseCase(completion as any, draws as any, ledger as any, () => roll, async () => undefined);

describe('granting a card', () => {
  it('grants exactly one card per delivered order however often the event replays', async () => {
    const uc = grantUc();
    const first = await uc.execute({ trigger: 'order_delivered', userId: 'u1', sourceType: 'order', sourceId: 'o1' });
    expect(first).toMatchObject({ ok: true, granted: true });
    const replay = await uc.execute({ trigger: 'order_delivered', userId: 'u1', sourceType: 'order', sourceId: 'o1' });
    expect(replay).toMatchObject({ ok: true, granted: false });
    expect(draws.tokens.size).toBe(1);
  });

  it('grants nothing while chance mechanics are switched off', async () => {
    completion.config = { ...BASE_CONFIG, chanceEnabled: false };
    expect(await grantUc().execute({ trigger: 'order_delivered', userId: 'u1', sourceType: 'order', sourceId: 'o1' }))
      .toMatchObject({ ok: false, code: 'CHANCE_DISABLED' });
    expect(draws.tokens.size).toBe(0);
  });

  it('grants nothing while the programme kill switch is on', async () => {
    completion.config = { ...BASE_CONFIG, killSwitch: true };
    expect(await grantUc().execute({ trigger: 'order_delivered', userId: 'u1', sourceType: 'order', sourceId: 'o1' }))
      .toMatchObject({ ok: false, code: 'PROGRAMME_DISABLED' });
  });
});

describe('playing a card', () => {
  const grantOne = async () => {
    await grantUc().execute({ trigger: 'order_delivered', userId: 'u1', sourceType: 'order', sourceId: 'o1' });
    return [...draws.tokens.values()][0].id;
  };

  it('awards the selected prize through the append-only ledger', async () => {
    const tokenId = await grantOne();
    const result = await playUc(9999).execute({ userId: 'u1', tokenId });
    expect(result).toMatchObject({ ok: true, points: 1000, replay: false });
    expect(ledger.pointsFor('u1')).toBe(1000);
    expect(ledger.entries[0].idempotencyKey).toBe(`draw:${tokenId}`);
  });

  it('cannot be played twice — concurrent submits yield exactly one prize', async () => {
    const tokenId = await grantOne();
    const uc = playUc(0);
    const [a, b, c] = await Promise.all([
      uc.execute({ userId: 'u1', tokenId }),
      uc.execute({ userId: 'u1', tokenId }),
      uc.execute({ userId: 'u1', tokenId }),
    ]);
    const wins = [a, b, c].filter((r) => r.ok && !(r as any).replay);
    expect(wins).toHaveLength(1);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.pointsFor('u1')).toBe(25);
  });

  it('replays the same recorded outcome instead of pretending the card was lost', async () => {
    const tokenId = await grantOne();
    const first = await playUc(9999).execute({ userId: 'u1', tokenId });
    const second = await playUc(0).execute({ userId: 'u1', tokenId });
    expect(second).toMatchObject({ ok: true, points: 1000, replay: true });
    expect((first as any).points).toBe((second as any).points);
    expect(ledger.entries).toHaveLength(1);
  });

  it('returns the card to the customer when the award fails on our side', async () => {
    const tokenId = await grantOne();
    ledger.failNext = true;
    await expect(playUc(0).execute({ userId: 'u1', tokenId })).rejects.toThrow('LEDGER_DOWN');
    expect(draws.tokens.get(tokenId)!.status).toBe('available');
    expect(ledger.entries).toHaveLength(0);
  });

  it('refuses another customer’s card', async () => {
    const tokenId = await grantOne();
    expect(await playUc(0).execute({ userId: 'someone-else', tokenId })).toMatchObject({ ok: false, code: 'TOKEN_NOT_FOUND' });
    expect(draws.tokens.get(tokenId)!.status).toBe('available');
  });

  it('refuses an expired card', async () => {
    const tokenId = await grantOne();
    const token = draws.tokens.get(tokenId)!;
    token.expiresAt = new Date('2020-01-01');
    expect(await playUc(0).execute({ userId: 'u1', tokenId })).toMatchObject({ ok: false, code: 'TOKEN_EXPIRED' });
  });

  it('refuses to pay out while the kill switch is on', async () => {
    const tokenId = await grantOne();
    completion.config = { ...BASE_CONFIG, killSwitch: true };
    expect(await playUc(0).execute({ userId: 'u1', tokenId })).toMatchObject({ ok: false, code: 'PROGRAMME_DISABLED' });
    expect(draws.tokens.get(tokenId)!.status).toBe('available');
  });

  it('counts the award against the campaign budget and the prize cap', async () => {
    const tokenId = await grantOne();
    await playUc(9999).execute({ userId: 'u1', tokenId });
    expect(draws.campaign.pointsAwarded).toBe(1000);
    expect(draws.prizes.find((p) => p.id === 'p1000')!.awardsMade).toBe(1);
  });
});
