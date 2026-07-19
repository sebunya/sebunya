/**
 * Customer DNA — canonical derived customer profile (pure domain).
 *
 * The profile is a PROJECTION over authoritative source systems (identity,
 * orders, consent, preferences, search, fulfilment, loyalty). It never replaces
 * those systems and never fabricates data. Absent inputs are represented with
 * truthful sentinel values, and every attribute is classified by how it was
 * obtained so a derived/predicted value is never presented as a declaration.
 */

/** How an attribute was obtained. A DERIVED/PREDICTED value must never be shown as DECLARED. */
export type AttributeClass = 'OBSERVED' | 'DECLARED' | 'DERIVED' | 'PREDICTED';

/** Truthful sentinels used instead of fabricating a value. */
export type TruthfulValue = 'UNKNOWN' | 'NOT_OBSERVED' | 'NOT_CONSENTED' | 'STALE' | 'CONFLICT_REVIEW_REQUIRED';

export const TRUTHFUL_VALUES: readonly TruthfulValue[] = ['UNKNOWN', 'NOT_OBSERVED', 'NOT_CONSENTED', 'STALE', 'CONFLICT_REVIEW_REQUIRED'];

/** Identity confidence for the canonical linkage. */
export type IdentityConfidence = 'VERIFIED' | 'HIGH' | 'MEDIUM' | 'LOW' | 'CONFLICT';

export type LifecycleStage =
  | 'PROSPECT' | 'NEW_CUSTOMER' | 'ACTIVATING' | 'ACTIVE' | 'AT_RISK' | 'LAPSED' | 'WIN_BACK';

export const LIFECYCLE_STAGES: readonly LifecycleStage[] = ['PROSPECT', 'NEW_CUSTOMER', 'ACTIVATING', 'ACTIVE', 'AT_RISK', 'LAPSED', 'WIN_BACK'];

export interface CustomerProfileSnapshot {
  canonicalCustomerId: string;
  /** Monotonic projection version — bumped only on a real source-version change. */
  profileVersion: number;
  /** Highest source version folded into this projection (drives idempotency). */
  sourceVersion: number;
  accountUserId: string | null;
  identityConfidence: IdentityConfidence;
  firstSeen: Date | null;
  lastSeen: Date | null;
  primaryLifecycleStage: LifecycleStage | 'UNKNOWN';
  /** Value/risk flags are DERIVED classifications, never customer declarations. */
  valueFlags: string[];
  riskFlags: string[];
  /** Consent eligibility summary (projection of the authoritative consent system). */
  consentEligible: boolean | TruthfulValue;
  communicationPreferences: Record<string, boolean> | TruthfulValue;
  freshness: Freshness;
  computedAt: Date;
}

export interface Freshness {
  computedAt: Date;
  /** Staleness horizon in hours; a projection older than this is STALE for surfacing. */
  staleAfterHours: number;
}

export function isStale(freshness: Freshness, now: Date): boolean {
  return now.getTime() - freshness.computedAt.getTime() > freshness.staleAfterHours * 3600_000;
}

/** A single computed feature carrying full provenance and freshness (never bare numbers). */
export interface CustomerFeature<T = number | string | boolean> {
  key: string;
  value: T | TruthfulValue;
  attributeClass: AttributeClass;
  source: string;
  sourceVersion: number;
  computedAt: Date;
  staleAfterHours: number;
}

export function feature<T>(input: {
  key: string;
  value: T | TruthfulValue;
  attributeClass: AttributeClass;
  source: string;
  sourceVersion: number;
  computedAt: Date;
  staleAfterHours?: number;
}): CustomerFeature<T> {
  return { staleAfterHours: 24, ...input };
}

/** Guard: a projection may only advance when the source version strictly increases. */
export function shouldReproject(current: { sourceVersion: number } | null, incomingSourceVersion: number): boolean {
  if (!current) return true;
  return incomingSourceVersion > current.sourceVersion;
}
