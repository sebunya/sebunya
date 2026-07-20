/**
 * Loyalty ledger domain (Slice 8). Pure — no Hono, Drizzle, adapters.
 *
 * Source-complete but DORMANT: every mutation requires both the
 * LOYALTY_PROGRAMME_ENABLED environment flag and the admin config's
 * enabled switch. Neither is turned on here — commercial activation is a
 * separate operator decision. No fake points: points exist only as ledger
 * entries derived from real orders or explicit admin adjustments.
 */

export const LOYALTY_ENTRY_TYPES = ['earn', 'redeem', 'reversal', 'expiry', 'adjustment'] as const;
export type LoyaltyEntryType = (typeof LOYALTY_ENTRY_TYPES)[number];

export interface LoyaltyLedgerEntry {
  id: string;
  accountId: string;
  type: LoyaltyEntryType;
  /** Signed: earn/adjustment(+) positive, redeem/expiry/reversal negative or positive (reversal negates its target). */
  points: number;
  orderId: string | null;
  reason: string;
  idempotencyKey: string;
  expiresAt: Date | null;
  reversedEntryId: string | null;
  createdAt: Date;
}

export interface LoyaltyConfig {
  enabled: boolean;
  /** Whole points earned per 1,000 UGX of a paid order's total. */
  earnRatePer1000Ugx: number;
  /** Days until earned points expire; 0 = never. */
  expiryDays: number;
}

export const DEFAULT_LOYALTY_CONFIG: LoyaltyConfig = { enabled: false, earnRatePer1000Ugx: 0, expiryDays: 0 };

const MAX_RATE = 1000;
const MAX_EXPIRY_DAYS = 3650;
export const MAX_POINTS_PER_ENTRY = 1_000_000; // fraud ceiling per single entry

export type ConfigValidation = { ok: true; value: LoyaltyConfig } | { ok: false; code: string; message: string };

export function validateLoyaltyConfig(input: { enabled?: unknown; earnRatePer1000Ugx?: unknown; expiryDays?: unknown }): ConfigValidation {
  const rate = typeof input.earnRatePer1000Ugx === 'number' ? input.earnRatePer1000Ugx : Number.NaN;
  if (!Number.isInteger(rate) || rate < 0 || rate > MAX_RATE) {
    return { ok: false, code: 'INVALID_RATE', message: `Earn rate must be a whole number of points per 1,000 UGX between 0 and ${MAX_RATE}.` };
  }
  const expiryDays = typeof input.expiryDays === 'number' ? input.expiryDays : Number.NaN;
  if (!Number.isInteger(expiryDays) || expiryDays < 0 || expiryDays > MAX_EXPIRY_DAYS) {
    return { ok: false, code: 'INVALID_EXPIRY', message: `Expiry must be between 0 (never) and ${MAX_EXPIRY_DAYS} days.` };
  }
  return { ok: true, value: { enabled: Boolean(input.enabled), earnRatePer1000Ugx: rate, expiryDays } };
}

/** Deterministic earn rule: floor(totalUgx / 1000) * rate, fraud-capped. */
export function computeEarnPoints(orderTotalUgx: number, config: LoyaltyConfig): number {
  if (!Number.isInteger(orderTotalUgx) || orderTotalUgx <= 0 || config.earnRatePer1000Ugx <= 0) return 0;
  return Math.min(Math.floor(orderTotalUgx / 1000) * config.earnRatePer1000Ugx, MAX_POINTS_PER_ENTRY);
}

export interface LoyaltyBalance {
  /** Points currently spendable (earned, unexpired, minus redemptions/reversals). */
  available: number;
  /** Earned points past their expiry that have not been formally expired or reversed yet. */
  pendingExpiry: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
}

export interface ExpirableEarn {
  entry: LoyaltyLedgerEntry;
  points: number;
}

/** FIFO liability allocation used to expire only the unspent remainder of an earn. */
export function computeExpirableEarns(entries: LoyaltyLedgerEntry[], now: Date): ExpirableEarn[] {
  const reversedSources = new Set(
    entries.filter((entry) => entry.type === 'reversal' && entry.reversedEntryId).map((entry) => entry.reversedEntryId as string),
  );
  const expiryByEarn = new Map(
    entries
      .filter((entry) => entry.type === 'expiry' && entry.reversedEntryId)
      .map((entry) => [entry.reversedEntryId as string, entry] as const),
  );
  let unallocatedRedemptions = entries
    .filter((entry) => entry.type === 'redeem' && !reversedSources.has(entry.id))
    .reduce((sum, entry) => sum + -entry.points, 0);
  const earns = entries
    .filter((entry) => entry.type === 'earn')
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
  const due: ExpirableEarn[] = [];
  for (const earn of earns) {
    if (reversedSources.has(earn.id)) continue;
    const expiry = expiryByEarn.get(earn.id);
    if (expiry) {
      const consumedBeforeExpiry = Math.max(0, earn.points + expiry.points);
      unallocatedRedemptions -= Math.min(consumedBeforeExpiry, unallocatedRedemptions);
      continue;
    }
    const consumed = Math.min(earn.points, unallocatedRedemptions);
    unallocatedRedemptions -= consumed;
    const remaining = earn.points - consumed;
    if (remaining > 0 && earn.expiresAt && earn.expiresAt.getTime() <= now.getTime()) {
      due.push({ entry: earn, points: remaining });
    }
  }
  return due;
}

/**
 * Balance is derived, never stored. Time alone never changes a balance: an
 * expired earn remains in the signed total until an explicit `expiry` entry
 * references it. This keeps every liability change attributable to one
 * immutable ledger event.
 */
export function computeBalance(entries: LoyaltyLedgerEntry[], now: Date): LoyaltyBalance {
  let signedTotal = 0;
  let pendingExpiry = 0;
  let lifetimeEarned = 0;
  let lifetimeRedeemed = 0;
  for (const e of entries) {
    signedTotal += e.points;
    if (e.type === 'earn') {
      lifetimeEarned += e.points;
    }
    if (e.type === 'redeem') lifetimeRedeemed += -e.points;
  }
  pendingExpiry = computeExpirableEarns(entries, now).reduce((sum, earn) => sum + earn.points, 0);
  return { available: signedTotal, pendingExpiry, lifetimeEarned, lifetimeRedeemed };
}

export function sameLedgerCommand(entry: LoyaltyLedgerEntry, input: {
  accountId: string;
  type: LoyaltyEntryType;
  points: number;
  orderId: string | null;
  expiresAt: Date | null;
  reversedEntryId: string | null;
}): boolean {
  return entry.accountId === input.accountId
    && entry.type === input.type
    && entry.points === input.points
    && entry.orderId === input.orderId
    && entry.expiresAt?.getTime() === input.expiresAt?.getTime()
    && entry.reversedEntryId === input.reversedEntryId;
}

export type EntryValidation = { ok: true } | { ok: false; code: string; message: string };

export function validateEarn(points: number, orderId: string | null): EntryValidation {
  if (!orderId) return { ok: false, code: 'ORDER_REQUIRED', message: 'Points can only be earned from a real order.' };
  if (!Number.isInteger(points) || points <= 0 || points > MAX_POINTS_PER_ENTRY) {
    return { ok: false, code: 'INVALID_POINTS', message: 'Earned points must be a positive whole number within the fraud ceiling.' };
  }
  return { ok: true };
}

export function validateRedeem(points: number, balance: LoyaltyBalance): EntryValidation {
  if (!Number.isInteger(points) || points <= 0 || points > MAX_POINTS_PER_ENTRY) {
    return { ok: false, code: 'INVALID_POINTS', message: 'Redeemed points must be a positive whole number within the fraud ceiling.' };
  }
  if (points > balance.available) {
    return { ok: false, code: 'INSUFFICIENT_BALANCE', message: 'Redemption exceeds the available balance.' };
  }
  return { ok: true };
}
