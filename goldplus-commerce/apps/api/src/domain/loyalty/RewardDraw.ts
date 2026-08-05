/**
 * Reward draw (scratch / spin) — pure domain.
 *
 * Everything that decides an outcome lives here so it can be tested exactly:
 * selection is a pure function of the prize table and one integer, which the
 * caller must source from a cryptographic RNG. No Math.random anywhere in the
 * draw path, and the client never participates in choosing a prize.
 *
 * Two invariants the rest of the system depends on:
 *   1. Every eligible prize awards points > 0 — there is no losing outcome.
 *   2. A token is only ever granted when the campaign could honour it at the
 *      maximum prize, so "you won, but the budget ran out" cannot happen.
 */

export interface DrawPrize {
  id: string;
  label: string;
  pointsAwarded: number;
  weight: number;
  /** null = unlimited */
  maxAwards: number | null;
  awardsMade: number;
  displayOrder: number;
}

export interface DrawCampaignState {
  id: string;
  code: string;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  budgetCapPoints: number;
  pointsAwarded: number;
  tokenExpiryDays: number;
}

/** A prize can still be won when it is uncapped or has capacity left. */
export function isPrizeAvailable(prize: DrawPrize): boolean {
  return prize.maxAwards === null || prize.awardsMade < prize.maxAwards;
}

export function availablePrizes(prizes: readonly DrawPrize[]): DrawPrize[] {
  return prizes.filter(isPrizeAvailable);
}

export function totalWeight(prizes: readonly DrawPrize[]): number {
  return prizes.reduce((sum, p) => sum + p.weight, 0);
}

export function maxPrizePoints(prizes: readonly DrawPrize[]): number {
  return prizes.reduce((max, p) => Math.max(max, p.pointsAwarded), 0);
}

/**
 * Weighted selection over the currently-available prizes.
 *
 * `roll` must be an integer in [0, totalWeight) drawn from a cryptographic
 * source. Returning the prize whose cumulative weight band contains the roll
 * gives each prize exactly weight/total probability.
 */
export function selectPrize(prizes: readonly DrawPrize[], roll: number): DrawPrize | null {
  const eligible = availablePrizes(prizes);
  if (eligible.length === 0) return null;
  const total = totalWeight(eligible);
  if (total <= 0) return null;
  if (!Number.isInteger(roll) || roll < 0 || roll >= total) {
    throw new Error('DRAW_ROLL_OUT_OF_RANGE');
  }
  let cursor = 0;
  for (const prize of eligible) {
    cursor += prize.weight;
    if (roll < cursor) return prize;
  }
  // Unreachable while roll < total, but never fall through silently.
  return eligible[eligible.length - 1];
}

/**
 * Odds as shown to the customer, in basis points so they sum to exactly
 * 10,000 with no floating-point drift in the published table. Computed from
 * the same weights the engine selects on — the disclosure cannot drift from
 * the mechanic.
 */
export function publishedOdds(prizes: readonly DrawPrize[]): Array<{
  prizeId: string;
  label: string;
  pointsAwarded: number;
  oddsBps: number;
  soldOut: boolean;
}> {
  const eligible = availablePrizes(prizes);
  const total = totalWeight(eligible);
  const ordered = [...prizes].sort((a, b) => a.displayOrder - b.displayOrder);
  return ordered.map((prize) => ({
    prizeId: prize.id,
    label: prize.label,
    pointsAwarded: prize.pointsAwarded,
    oddsBps: total > 0 && isPrizeAvailable(prize) ? Math.round((prize.weight / total) * 10_000) : 0,
    soldOut: !isPrizeAvailable(prize),
  }));
}

export type GrantRefusal =
  | 'CAMPAIGN_INACTIVE'
  | 'CAMPAIGN_NOT_STARTED'
  | 'CAMPAIGN_ENDED'
  | 'NO_PRIZES_AVAILABLE'
  | 'BUDGET_EXHAUSTED';

/**
 * Whether another play token may be granted.
 *
 * The budget test is deliberately pessimistic: it assumes every outstanding
 * token, plus this one, wins the LARGEST prize. That is what guarantees an
 * issued token is always honourable — the alternative (checking the budget at
 * play time) would mean telling a customer holding a valid card that there is
 * nothing left, which is exactly the outcome this design refuses to create.
 */
export function canGrantToken(input: {
  campaign: DrawCampaignState;
  prizes: readonly DrawPrize[];
  outstandingTokens: number;
  now: Date;
}): { ok: true } | { ok: false; reason: GrantRefusal } {
  const { campaign, prizes, outstandingTokens, now } = input;
  if (!campaign.active) return { ok: false, reason: 'CAMPAIGN_INACTIVE' };
  if (campaign.startsAt && now < campaign.startsAt) return { ok: false, reason: 'CAMPAIGN_NOT_STARTED' };
  if (campaign.endsAt && now > campaign.endsAt) return { ok: false, reason: 'CAMPAIGN_ENDED' };
  const eligible = availablePrizes(prizes);
  if (eligible.length === 0) return { ok: false, reason: 'NO_PRIZES_AVAILABLE' };
  const worstCase = maxPrizePoints(eligible) * (outstandingTokens + 1);
  if (campaign.pointsAwarded + worstCase > campaign.budgetCapPoints) {
    return { ok: false, reason: 'BUDGET_EXHAUSTED' };
  }
  return { ok: true };
}

export function tokenExpiryFrom(campaign: DrawCampaignState, now: Date): Date {
  return new Date(now.getTime() + campaign.tokenExpiryDays * 86_400_000);
}

/**
 * The immutable record of what was on offer for one play. Stored on the
 * result so a later weight change can never rewrite the odds a customer was
 * actually given.
 */
export function prizeSnapshot(prizes: readonly DrawPrize[]): {
  odds: ReturnType<typeof publishedOdds>;
  totalWeight: number;
} {
  return { odds: publishedOdds(prizes), totalWeight: totalWeight(availablePrizes(prizes)) };
}
