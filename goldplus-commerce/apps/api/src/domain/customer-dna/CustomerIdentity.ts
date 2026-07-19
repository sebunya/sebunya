/**
 * Customer DNA — identity resolution (pure domain).
 *
 * Identity is resolved ONLY through approved first-party signals. Weak similarity
 * (matching names, locations or browsing patterns) never merges profiles. Merges
 * are idempotent and auditable; a signal that maps to two different canonical
 * customers is a CONFLICT for manual review, never an automatic silent merge.
 */

import { IdentityConfidence } from './CustomerProfile';

/** Approved first-party linkage signals. */
export type IdentitySignalType =
  | 'AUTHENTICATED_CUSTOMER_ID'
  | 'VERIFIED_EMAIL'
  | 'VERIFIED_PHONE'
  | 'ORDER_CUSTOMER_RELATIONSHIP'
  | 'EXPLICIT_MERGE'
  | 'STABLE_ANONYMOUS_ID';

export const APPROVED_IDENTITY_SIGNALS: readonly IdentitySignalType[] = [
  'AUTHENTICATED_CUSTOMER_ID',
  'VERIFIED_EMAIL',
  'VERIFIED_PHONE',
  'ORDER_CUSTOMER_RELATIONSHIP',
  'EXPLICIT_MERGE',
  'STABLE_ANONYMOUS_ID',
];

export type IdentityLinkStatus = 'ACTIVE' | 'CONFLICT' | 'MERGED' | 'SPLIT';

export interface IdentityLinkSnapshot {
  id: string;
  canonicalCustomerId: string;
  signalType: IdentitySignalType;
  /** Stored as a stable hash or masked value — never raw PII in the projection layer. */
  identifierKey: string;
  confidence: IdentityConfidence;
  status: IdentityLinkStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Map an approved signal to its intrinsic confidence. Weak signals are rejected upstream. */
export function signalConfidence(signal: IdentitySignalType): IdentityConfidence {
  switch (signal) {
    case 'AUTHENTICATED_CUSTOMER_ID':
    case 'EXPLICIT_MERGE':
      return 'VERIFIED';
    case 'VERIFIED_EMAIL':
    case 'VERIFIED_PHONE':
      return 'HIGH';
    case 'ORDER_CUSTOMER_RELATIONSHIP':
      return 'MEDIUM';
    case 'STABLE_ANONYMOUS_ID':
      return 'LOW';
  }
}

export type IdentityRejectionReason =
  | 'WEAK_SIGNAL'
  | 'MISSING_IDENTIFIER'
  | 'UNAPPROVED_SIGNAL';

/**
 * A link may proceed only for an approved signal with a concrete identifier.
 * Anything resembling name/location/browser-pattern similarity is a WEAK_SIGNAL.
 */
export function canLinkIdentity(input: { signalType: string; identifierKey: string | null | undefined }):
  | { ok: true; signalType: IdentitySignalType; confidence: IdentityConfidence }
  | { ok: false; reason: IdentityRejectionReason } {
  if (!APPROVED_IDENTITY_SIGNALS.includes(input.signalType as IdentitySignalType)) {
    return { ok: false, reason: 'UNAPPROVED_SIGNAL' };
  }
  if (!input.identifierKey || !input.identifierKey.trim()) {
    return { ok: false, reason: 'MISSING_IDENTIFIER' };
  }
  return { ok: true, signalType: input.signalType as IdentitySignalType, confidence: signalConfidence(input.signalType as IdentitySignalType) };
}

/**
 * Resolve where a signal should attach. If the identifier already binds to a
 * different canonical customer, the result is a CONFLICT (manual review), never
 * an automatic merge. Re-asserting the same binding is idempotent.
 */
export function resolveLinkTarget(input: {
  existingCanonicalForIdentifier: string | null;
  proposedCanonical: string;
}): { outcome: 'CREATE' | 'IDEMPOTENT' | 'CONFLICT'; canonicalCustomerId: string } {
  if (input.existingCanonicalForIdentifier === null) {
    return { outcome: 'CREATE', canonicalCustomerId: input.proposedCanonical };
  }
  if (input.existingCanonicalForIdentifier === input.proposedCanonical) {
    return { outcome: 'IDEMPOTENT', canonicalCustomerId: input.proposedCanonical };
  }
  return { outcome: 'CONFLICT', canonicalCustomerId: input.existingCanonicalForIdentifier };
}

/** Merge is only permitted VERIFIED→ or via EXPLICIT_MERGE; otherwise route to review. */
export function canMergeProfiles(input: { signalType: IdentitySignalType }): boolean {
  return input.signalType === 'AUTHENTICATED_CUSTOMER_ID' || input.signalType === 'EXPLICIT_MERGE' || input.signalType === 'VERIFIED_EMAIL' || input.signalType === 'VERIFIED_PHONE';
}

/** Highest confidence across a customer's active links drives the profile confidence. */
export function aggregateConfidence(links: { confidence: IdentityConfidence; status: IdentityLinkStatus }[]): IdentityConfidence {
  const active = links.filter((l) => l.status === 'ACTIVE');
  if (links.some((l) => l.status === 'CONFLICT')) return 'CONFLICT';
  const order: IdentityConfidence[] = ['VERIFIED', 'HIGH', 'MEDIUM', 'LOW'];
  for (const c of order) if (active.some((l) => l.confidence === c)) return c;
  return 'LOW';
}
