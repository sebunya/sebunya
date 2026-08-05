import { ILoyaltyRepository } from '../../ports/ILoyaltyRepository';
import { ILoyaltyCompletionRepository } from '../../ports/ILoyaltyCompletion';
import {
  DrawCampaignState,
  DrawComplianceState,
  DrawPrize,
  canGrantToken,
  canRunDraw,
  isAgeEligible,
  prizeSnapshot,
  publishedOdds,
  selectPrize,
  tokenExpiryFrom,
  totalWeight,
  availablePrizes,
} from '../../../domain/loyalty/RewardDraw';

type Fail = { ok: false; code: string; message: string };
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });

export interface DrawTokenRow {
  id: string;
  campaignId: string;
  userId: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface ILoyaltyDrawRepository {
  findActiveCampaignByTrigger(trigger: string): Promise<DrawCampaignState | null>;
  findCampaignById(campaignId: string): Promise<DrawCampaignState | null>;
  listPrizes(campaignId: string): Promise<DrawPrize[]>;
  countOutstandingTokens(campaignId: string): Promise<number>;
  /** Idempotent on (campaign, sourceType, sourceId): returns null when one already exists. */
  grantToken(input: {
    campaignId: string;
    userId: string;
    accountId: string | null;
    sourceType: string;
    sourceId: string;
    expiresAt: Date;
  }): Promise<DrawTokenRow | null>;
  listAvailableTokens(userId: string, now: Date): Promise<DrawTokenRow[]>;
  findToken(tokenId: string): Promise<DrawTokenRow | null>;
  /**
   * Atomically move one token from 'available' to 'played'. MUST be a
   * conditional update returning the row only if it made the transition —
   * this is the single-use guarantee under concurrent submits.
   */
  claimToken(tokenId: string, userId: string, now: Date): Promise<DrawTokenRow | null>;
  releaseToken(tokenId: string): Promise<void>;
  recordResult(input: {
    tokenId: string;
    campaignId: string;
    prizeId: string;
    userId: string;
    pointsAwarded: number;
    ledgerEntryId: string | null;
    prizeSnapshot: unknown;
  }): Promise<void>;
  incrementPrizeAward(prizeId: string): Promise<void>;
  incrementCampaignTotals(campaignId: string, pointsAwarded: number, tokensGranted: number): Promise<void>;
  findResultByToken(tokenId: string): Promise<{ pointsAwarded: number; prizeId: string } | null>;
  expireTokensDueBefore(now: Date): Promise<number>;
  /** 0090: the recorded legal basis on which draws may operate. */
  getCompliance(): Promise<DrawComplianceState>;
  /** 0090: the participant facts the compliance gates need. */
  participantEligibility(userId: string): Promise<{ dateOfBirth: string | null; selfExcludedAt: Date | null }>;
}

/** Cryptographic roll in [0, max). Injected so tests can be exact. */
export type RandomInt = (maxExclusive: number) => number;

/**
 * Grant a play token for a verified completion event.
 *
 * Idempotent on the source event, gated by the programme kill switch, the
 * chance_enabled flag and campaign activation, and refused when the campaign
 * could not honour the token at its maximum prize.
 */
export class GrantDrawTokenUseCase {
  constructor(
    private readonly completion: ILoyaltyCompletionRepository,
    private readonly draws: ILoyaltyDrawRepository,
    private readonly loyalty: ILoyaltyRepository,
  ) {}

  async execute(input: {
    trigger: string;
    userId: string;
    sourceType: string;
    sourceId: string;
    now?: Date;
  }): Promise<{ ok: true; granted: boolean; tokenId?: string } | Fail> {
    const now = input.now ?? new Date();
    const config = await this.completion.getProgrammeConfig();
    if (!config.enabled || config.killSwitch) return fail('PROGRAMME_DISABLED', 'Programme inactive.');
    if (!config.chanceEnabled) return fail('CHANCE_DISABLED', 'Reward draws are not enabled.');

    // 0090 compliance gates, checked BEFORE anything is issued.
    const compliance = await this.draws.getCompliance();
    const permitted = canRunDraw(compliance, now);
    if (!permitted.ok) return fail(permitted.reason, 'Reward draws are not permitted to run.');

    const participant = await this.draws.participantEligibility(input.userId);
    if (participant.selfExcludedAt) return fail('SELF_EXCLUDED', 'This account has opted out of prize draws.');
    if (!isAgeEligible(participant.dateOfBirth, compliance.minAge, now)) {
      // Fail closed: an unknown age is not an eligible age.
      return fail('AGE_NOT_ELIGIBLE', `Prize draws are limited to customers aged ${compliance.minAge} and over.`);
    }

    const campaign = await this.draws.findActiveCampaignByTrigger(input.trigger);
    if (!campaign) return { ok: true, granted: false };

    const prizes = await this.draws.listPrizes(campaign.id);
    const outstanding = await this.draws.countOutstandingTokens(campaign.id);
    const verdict = canGrantToken({ campaign, prizes, outstandingTokens: outstanding, now });
    if (!verdict.ok) return fail(verdict.reason, 'No play token was granted.');

    const account = await this.loyalty.getOrCreateAccount(input.userId);
    const token = await this.draws.grantToken({
      campaignId: campaign.id,
      userId: input.userId,
      accountId: account.id,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      expiresAt: tokenExpiryFrom(campaign, now),
    });
    if (!token) return { ok: true, granted: false }; // already granted for this event
    await this.draws.incrementCampaignTotals(campaign.id, 0, 1);
    return { ok: true, granted: true, tokenId: token.id };
  }
}

/**
 * Play one token.
 *
 * Order of operations matters and is deliberate:
 *   1. claim the token atomically (available → played). Anything after this
 *      point runs at most once per token, however many requests race.
 *   2. select the prize server-side from a cryptographic roll.
 *   3. append the points to the append-only ledger under `draw:<tokenId>`.
 *   4. record the result with the odds snapshot.
 * If selection or the ledger append fails, the token is released back to
 * 'available' so the customer never loses a card to a server error.
 */
export class PlayDrawTokenUseCase {
  constructor(
    private readonly completion: ILoyaltyCompletionRepository,
    private readonly draws: ILoyaltyDrawRepository,
    private readonly loyalty: ILoyaltyRepository,
    private readonly randomInt: RandomInt,
    private readonly notify: (input: { userId: string; points: number; label: string }) => Promise<unknown>,
  ) {}

  async execute(input: {
    userId: string;
    tokenId: string;
    now?: Date;
  }): Promise<{ ok: true; label: string; points: number; replay: boolean } | Fail> {
    const now = input.now ?? new Date();
    const config = await this.completion.getProgrammeConfig();
    if (!config.enabled || config.killSwitch) return fail('PROGRAMME_DISABLED', 'Programme inactive.');
    if (!config.chanceEnabled) return fail('CHANCE_DISABLED', 'Reward draws are not enabled.');

    // Re-checked at play time, not just at grant: a licence can lapse or an
    // exclusion be requested between issuing a card and playing it.
    const compliance = await this.draws.getCompliance();
    const permitted = canRunDraw(compliance, now);
    if (!permitted.ok) return fail(permitted.reason, 'Reward draws are not permitted to run.');
    const participant = await this.draws.participantEligibility(input.userId);
    if (participant.selfExcludedAt) return fail('SELF_EXCLUDED', 'This account has opted out of prize draws.');
    if (!isAgeEligible(participant.dateOfBirth, compliance.minAge, now)) {
      return fail('AGE_NOT_ELIGIBLE', `Prize draws are limited to customers aged ${compliance.minAge} and over.`);
    }

    const existing = await this.draws.findToken(input.tokenId);
    if (!existing || existing.userId !== input.userId) {
      return fail('TOKEN_NOT_FOUND', 'That card does not exist.');
    }
    // An already-played token returns its recorded prize rather than an error,
    // so a refresh or a double submit shows the same outcome instead of
    // looking like a lost card.
    if (existing.status === 'played') {
      const result = await this.draws.findResultByToken(existing.id);
      if (result) {
        const prizes = await this.draws.listPrizes(existing.campaignId);
        const prize = prizes.find((p) => p.id === result.prizeId);
        return { ok: true, label: prize?.label ?? `${result.pointsAwarded} points`, points: result.pointsAwarded, replay: true };
      }
      return fail('TOKEN_USED', 'That card has already been used.');
    }
    if (existing.status === 'expired' || existing.expiresAt <= now) {
      return fail('TOKEN_EXPIRED', 'That card has expired.');
    }

    const claimed = await this.draws.claimToken(input.tokenId, input.userId, now);
    if (!claimed) return fail('TOKEN_USED', 'That card has already been used.');

    try {
      const campaign = await this.draws.findCampaignById(existing.campaignId);
      if (!campaign) throw new Error('CAMPAIGN_MISSING');
      const prizes = await this.draws.listPrizes(campaign.id);
      const eligible = availablePrizes(prizes);
      const total = totalWeight(eligible);
      if (total <= 0) throw new Error('NO_PRIZES_AVAILABLE');

      const snapshot = prizeSnapshot(prizes);
      const prize = selectPrize(prizes, this.randomInt(total));
      if (!prize) throw new Error('NO_PRIZES_AVAILABLE');

      const account = await this.loyalty.getOrCreateAccount(input.userId);
      const { entry } = await this.loyalty.append({
        accountId: account.id,
        type: 'adjustment',
        points: prize.pointsAwarded,
        orderId: null,
        reason: `Scratch card: ${prize.label}`,
        idempotencyKey: `draw:${claimed.id}`, // one award per token, ever
        expiresAt: null,
        reversedEntryId: null,
        ruleCode: 'reward_draw',
        ruleVersion: 1,
      });

      await this.draws.recordResult({
        tokenId: claimed.id,
        campaignId: campaign.id,
        prizeId: prize.id,
        userId: input.userId,
        pointsAwarded: prize.pointsAwarded,
        ledgerEntryId: entry.id,
        prizeSnapshot: snapshot,
      });
      await this.draws.incrementPrizeAward(prize.id);
      await this.draws.incrementCampaignTotals(campaign.id, prize.pointsAwarded, 0);
      await this.notify({ userId: input.userId, points: prize.pointsAwarded, label: prize.label }).catch(() => undefined);

      return { ok: true, label: prize.label, points: prize.pointsAwarded, replay: false };
    } catch (error) {
      // The customer keeps their card if anything went wrong on our side.
      await this.draws.releaseToken(input.tokenId).catch(() => undefined);
      if ((error as Error).message === 'NO_PRIZES_AVAILABLE') {
        return fail('NO_PRIZES_AVAILABLE', 'No prizes are currently available. Your card has been kept.');
      }
      throw error;
    }
  }
}

/** What the customer sees before playing: their cards and the published odds. */
export class GetDrawStateUseCase {
  constructor(
    private readonly completion: ILoyaltyCompletionRepository,
    private readonly draws: ILoyaltyDrawRepository,
  ) {}

  async execute(input: { userId: string; now?: Date }): Promise<{
    enabled: boolean;
    tokens: Array<{ id: string; expiresAt: string }>;
    campaign: { code: string; name: string; description: string | null } | null;
    odds: ReturnType<typeof publishedOdds>;
    /** Why this customer cannot take part, when that is the case. */
    ineligible?: { reason: string; message: string };
  }> {
    const now = input.now ?? new Date();
    const config = await this.completion.getProgrammeConfig();
    if (!config.enabled || config.killSwitch || !config.chanceEnabled) {
      return { enabled: false, tokens: [], campaign: null, odds: [] };
    }
    const compliance = await this.draws.getCompliance();
    if (!canRunDraw(compliance, now).ok) return { enabled: false, tokens: [], campaign: null, odds: [] };
    const participant = await this.draws.participantEligibility(input.userId);
    if (participant.selfExcludedAt) {
      return {
        enabled: false,
        tokens: [],
        campaign: null,
        odds: [],
        ineligible: { reason: 'SELF_EXCLUDED', message: 'You have opted out of prize draws. Contact support if you want that changed.' },
      };
    }
    if (!isAgeEligible(participant.dateOfBirth, compliance.minAge, now)) {
      return {
        enabled: false,
        tokens: [],
        campaign: null,
        odds: [],
        ineligible: {
          reason: 'AGE_NOT_ELIGIBLE',
          message: participant.dateOfBirth
            ? `Prize draws are limited to customers aged ${compliance.minAge} and over.`
            : `Add your date of birth to your account to take part — prize draws are limited to customers aged ${compliance.minAge} and over.`,
        },
      };
    }
    const tokens = await this.draws.listAvailableTokens(input.userId, now);
    const campaign = await this.draws.findActiveCampaignByTrigger('order_delivered');
    if (!campaign) return { enabled: false, tokens: [], campaign: null, odds: [] };
    const prizes = await this.draws.listPrizes(campaign.id);
    const full = await this.draws.findCampaignById(campaign.id);
    return {
      enabled: true,
      tokens: tokens.map((t) => ({ id: t.id, expiresAt: t.expiresAt.toISOString() })),
      campaign: {
        code: campaign.code,
        name: (full as unknown as { name?: string })?.name ?? campaign.code,
        description: (full as unknown as { description?: string | null })?.description ?? null,
      },
      odds: publishedOdds(prizes),
    };
  }
}
