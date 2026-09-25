import type { IdentitySignalType, IdentityLinkSnapshot } from '../../../domain/customer-dna/CustomerIdentity';
import type { CustomerFacts } from '../../../domain/first-party/CustomerFacts';
import type { SegmentDefinition } from '../../../domain/first-party/Segments';
import type { PlatformHashedIdentifiers } from '../../../domain/first-party/AudienceHashing';
import type { StoredPhone, PlannedNormalisation } from '../../../domain/first-party/PhoneHygiene';
import type { Customer360Records } from '../../../domain/first-party/Customer360';
import type { PrivacyRequestKind, PrivacyRequestStatus } from '../../../domain/first-party/PrivacyRequests';

/** Keyed HMAC of an already-normalised value. null = hashing not configured (never a fallback hash). */
export interface IIdentifierHasher {
  hash(normalisedValue: string): string | null;
}

/** The account behind a user id, as far as identity needs it. */
export interface IAccountIdentityReader {
  findAccount(userId: string): Promise<{ id: string; email: string | null; phone: string | null; phoneVerified: boolean } | null>;
}

/** Has this person or browser explicitly refused on-site personalisation? Throws on a read failure. */
export interface IPersonalisationConsentReader {
  personalisationRefused(who: { userId?: string | null; fpClientId?: string | null }): Promise<boolean>;
}

export interface IdentityConflictRecord {
  id: string;
  linkId: string | null;
  signalType: string;
  identifierKey: string;
  existingCanonicalId: string;
  proposedCanonicalId: string;
  moment: string | null;
  occurrences: number;
  status: 'OPEN' | 'RESOLVED';
  resolution: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface IIdentityConflictRepository {
  /** Idempotent per open (signal, identifier, existing, proposed): a repeat bumps occurrences. */
  record(input: { linkId: string | null; signalType: IdentitySignalType; identifierKey: string; existingCanonicalId: string; proposedCanonicalId: string; moment?: string | null }): Promise<{ created: boolean; id: string }>;
  listOpen(limit: number): Promise<IdentityConflictRecord[]>;
  findById(id: string): Promise<IdentityConflictRecord | null>;
  /** OPEN → RESOLVED; false when it was not open (already resolved by someone else). */
  markResolved(id: string, input: { resolution: string; actorId: string; reason: string }): Promise<boolean>;
}

export interface IIdentityMergeRepository {
  /** Attach an account to a guest profile that has none. false when it already had one. */
  attachAccount(canonicalCustomerId: string, accountUserId: string): Promise<boolean>;
  /** Move every link of a GUEST profile to another profile and mark it merged. Transactional. */
  foldGuestInto(fromCanonicalId: string, intoCanonicalId: string): Promise<{ folded: boolean; movedLinks: number }>;
  reassignLink(linkId: string, canonicalCustomerId: string): Promise<void>;
  profileState(canonicalCustomerId: string): Promise<{ exists: boolean; accountUserId: string | null; mergedInto: string | null }>;
  findLink(linkId: string): Promise<IdentityLinkSnapshot | null>;
}

/** Orders the nightly backfill has not yet linked to a customer. */
export interface IOrderIdentityBackfillReader {
  listUnlinkedOrders(limit: number): Promise<Array<{
    orderId: string; userId: string | null; customerEmail: string | null; customerPhone: string | null;
    profileId: string | null; fpClientId: string | null;
  }>>;
}

export interface ICustomerFactsReader {
  /** Facts for every live (not merged) canonical customer. Throws when the input exceeds its bound. */
  readAll(now: Date): Promise<CustomerFacts[]>;
  listCategories(): Promise<Array<{ id: string; name: string }>>;
}

export interface SegmentRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  definition: SegmentDefinition;
  status: 'ACTIVE' | 'ARCHIVED';
  memberCount: number | null;
  lastMaterialisedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SegmentRunRecord {
  id: string;
  trigger: string;
  status: 'RUNNING' | 'COMPLETE' | 'FAILED' | 'SKIPPED';
  startedAt: Date;
  finishedAt: Date | null;
  customersEvaluated: number | null;
  segmentsEvaluated: number | null;
  ordersStitched: number | null;
  stats: Record<string, unknown>;
  error: string | null;
}

export interface ISegmentRepository {
  list(includeArchived: boolean): Promise<SegmentRecord[]>;
  findById(id: string): Promise<SegmentRecord | null>;
  findByKey(key: string): Promise<SegmentRecord | null>;
  create(input: { key: string; name: string; description: string | null; definition: SegmentDefinition; actorId: string }): Promise<SegmentRecord>;
  update(id: string, input: { name: string; description: string | null; definition: SegmentDefinition; actorId: string }): Promise<SegmentRecord | null>;
  setStatus(id: string, status: 'ACTIVE' | 'ARCHIVED', actorId: string): Promise<boolean>;
  /** Replace the member set for one segment (insert new, drop gone, keep first_matched_at). */
  replaceMembers(segmentId: string, runId: string, canonicalIds: string[], at: Date): Promise<{ added: number; removed: number; total: number }>;
  listMembers(segmentId: string, limit: number, afterCanonicalId?: string | null): Promise<Array<{ canonicalCustomerId: string; firstMatchedAt: Date }>>;
  startRun(trigger: string): Promise<string>;
  finishRun(id: string, input: { status: SegmentRunRecord['status']; customersEvaluated?: number; segmentsEvaluated?: number; ordersStitched?: number; stats?: Record<string, unknown>; error?: string | null }): Promise<void>;
  listRuns(limit: number): Promise<SegmentRunRecord[]>;
  lastCompletedRunAt(): Promise<Date | null>;
}

/** Contact details for a set of canonical customers — first-party, never leaves the API raw. */
export interface ICustomerContactReader {
  contactsFor(canonicalIds: string[]): Promise<Array<{
    canonicalCustomerId: string; accountUserId: string | null; email: string | null; phone: string | null; fpClientIds: string[];
  }>>;
}

/**
 * D-002: an explicit, stored advertising refusal — THE predicate the audience
 * sync uses (AdvertisingConsentGate via refusedAmong): the account, every
 * browser, and every browser linked to the account (identity_links), with no
 * cap on the number of browsers. Throws on read failure.
 */
export interface IAdvertisingRefusalReader {
  refused(who: { userId?: string | null; fpClientIds: string[] }): Promise<boolean>;
  /**
   * The same predicate for many people in ONE read. Returns the keys of the
   * subjects who refused. Throws on read failure (the caller excludes the
   * whole batch: never uploaded on an unknown answer).
   */
  refusedMany(subjects: Array<{ key: string; userId?: string | null; fpClientIds: string[] }>): Promise<Set<string>>;
}

/** Marketing gate for WhatsApp, per account. */
export interface IWhatsAppMarketingGate {
  mayMarket(accountUserId: string): Promise<{ allowed: boolean; reason: string; phoneE164: string | null }>;
}

/**
 * THE port the advertising audience sync (and future messaging) consumes. It
 * returns only customers whose consent allows the use, and only hashes for
 * advertising.
 */
export interface ISegmentAudienceSource {
  advertisingAudience(segmentId: string, opts?: { limit?: number }): Promise<{
    status: 'OK' | 'SEGMENT_NOT_FOUND' | 'SEGMENT_ARCHIVED' | 'NOT_MATERIALISED';
    segment: { id: string; key: string; name: string; materialisedAt: string | null } | null;
    members: Array<{ canonicalCustomerId: string; hashed: PlatformHashedIdentifiers }>;
    excludedAdvertisingRefused: number;
    excludedNoIdentifier: number;
    excludedConsentUnknown: number;
  }>;
  messagingAudience(segmentId: string, channel: 'whatsapp', opts?: { limit?: number }): Promise<{
    status: 'OK' | 'SEGMENT_NOT_FOUND' | 'SEGMENT_ARCHIVED' | 'NOT_MATERIALISED';
    members: Array<{ canonicalCustomerId: string; accountUserId: string; phoneE164: string }>;
    excludedNotOptedIn: number;
    excludedGuest: number;
  }>;
}

export interface IPhoneHygieneRepository {
  loadAll(): Promise<StoredPhone[]>;
  /** Apply one normalisation if the stored value is still `from`; logs it. false = value changed meanwhile. */
  applyNormalisation(runId: string, n: PlannedNormalisation): Promise<boolean>;
}

export interface IConsentEvidenceRepository {
  record(input: {
    consentEventId: string; purposeKey: string; channelKey: string; endpointHash: string | null; endpointMasked: string | null;
    copyVersionId: string; copyTextHash: string; confirmation: string; ipHash: string | null; userAgentHash: string | null; sourceSurface: string;
  }): Promise<void>;
  latestFor(consentEventId: string): Promise<{ endpointHash: string | null; capturedAt: Date } | null>;
}

/**
 * 0157: browsers tied to a customer ONLY for consent enforcement (identity
 * stitching was not allowed to link them as behaviour). Idempotent.
 */
export interface IConsentAnchorRepository {
  record(input: { canonicalCustomerId: string; fpClientId: string; reason: 'PERSONALISATION_REFUSED' | 'CONSENT_UNREADABLE' }): Promise<void>;
}

/** 0157: everything one customer profile is assembled from (Customer 360). */
export interface ICustomer360Reader {
  /** null = no such live profile (unknown, or folded into another). */
  read(canonicalCustomerId: string): Promise<Customer360Records | null>;
  /** The live profile holding this account, if any. */
  canonicalForAccount(accountUserId: string): Promise<string | null>;
}

/** 0157: the real inputs next-best-action reads (NextBestAction.buildNbaContextFromProfile). */
export interface INbaContextReader {
  read(input: { canonicalCustomerId: string; accountUserId: string | null }): Promise<{
    marketingChannels: Record<string, boolean>;
    openSupportCases: number;
    openFraudCases: number;
    recentPurchaseProductIds: string[];
    outOfStockProductIds: string[];
    /** null = could not be read (treated as capped). */
    messagesSentLast7Days: number | null;
    loyaltyBalance: number | null;
  }>;
}

export interface PrivacyRequestRecord {
  id: string;
  reference: string;
  userId: string;
  kind: PrivacyRequestKind;
  status: PrivacyRequestStatus;
  customerNote: string | null;
  requestedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionReason: string | null;
  completedAt: Date | null;
  result: Record<string, unknown>;
}

export interface IPrivacyRequestRepository {
  /** Idempotent per idempotency key; an open request of the same kind is returned as `existing`. */
  create(input: { reference: string; userId: string; kind: PrivacyRequestKind; status: PrivacyRequestStatus; customerNote: string | null; idempotencyKey: string | null; result?: Record<string, unknown> }):
    Promise<{ record: PrivacyRequestRecord; created: boolean }>;
  findById(id: string): Promise<PrivacyRequestRecord | null>;
  listForUser(userId: string, limit: number): Promise<PrivacyRequestRecord[]>;
  list(input: { status?: PrivacyRequestStatus | null; limit: number }): Promise<PrivacyRequestRecord[]>;
  countExportsSince(userId: string, since: Date): Promise<number>;
  /** RECEIVED → another status; false when it was no longer RECEIVED. */
  transition(id: string, input: { to: Exclude<PrivacyRequestStatus, 'RECEIVED'>; actorId: string | null; reason: string | null; result?: Record<string, unknown> }): Promise<boolean>;
}

/** The customer's own data, as a portable document (no internal or cost fields). */
export interface IPersonalDataExporter {
  collect(userId: string): Promise<{ sections: Record<string, unknown>; counts: Record<string, number> } | null>;
}

/**
 * Carries out an erasure in ONE transaction, together with marking the request
 * COMPLETED (guarded on it still being RECEIVED: a second click changes nothing).
 * Returns counts per table, never values.
 */
export interface IPersonalDataEraser {
  openOrderCount(userId: string): Promise<number>;
  erase(input: { userId: string; kind: 'ANONYMISE_HISTORY' | 'DELETE_ACCOUNT'; requestId: string; actorId: string; reason: string }):
    Promise<{ completed: boolean; counts: Record<string, number> }>;
}
