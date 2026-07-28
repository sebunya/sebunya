import { CustomerProfileSnapshot, CustomerFeature, LifecycleStage } from '../../domain/customer-dna/CustomerProfile';
import { IdentityLinkSnapshot, IdentitySignalType, IdentityLinkStatus } from '../../domain/customer-dna/CustomerIdentity';
import { RawCustomerSignals } from '../../domain/customer-dna/CustomerFeatures';
import { NbaDecision } from '../../domain/customer-dna/NextBestAction';

export interface ICustomerProfileRepository {
  /** Create the canonical profile row (used when a first link is established). */
  create(input: { canonicalCustomerId?: string; accountUserId: string | null }): Promise<CustomerProfileSnapshot>;
  findByCanonicalId(canonicalCustomerId: string): Promise<CustomerProfileSnapshot | null>;
  findByAccountUserId(accountUserId: string): Promise<CustomerProfileSnapshot | null>;
  /** Idempotent projection update — only advances when sourceVersion strictly increases. */
  upsertProjection(snapshot: CustomerProfileSnapshot): Promise<{ updated: boolean; profileVersion: number }>;
  search(query: string, limit: number): Promise<CustomerProfileSnapshot[]>;
}

export interface IdentityLinkCreate {
  canonicalCustomerId: string;
  signalType: IdentitySignalType;
  identifierKey: string;
  confidence: string;
  status?: IdentityLinkStatus;
}

export interface ICustomerIdentityRepository {
  findByIdentifier(signalType: IdentitySignalType, identifierKey: string): Promise<IdentityLinkSnapshot | null>;
  listLinks(canonicalCustomerId: string): Promise<IdentityLinkSnapshot[]>;
  /** Idempotent create on the unique (signal_type, identifier_key). */
  link(input: IdentityLinkCreate): Promise<{ created: boolean; link: IdentityLinkSnapshot }>;
  setStatus(id: string, status: IdentityLinkStatus): Promise<void>;
  listConflicts(limit: number): Promise<IdentityLinkSnapshot[]>;
}

export interface ICustomerFeatureRepository {
  /** Idempotent per (canonical, sourceVersion). */
  saveSnapshot(canonicalCustomerId: string, sourceVersion: number, features: CustomerFeature[]): Promise<{ created: boolean }>;
  latest(canonicalCustomerId: string): Promise<{ sourceVersion: number; features: CustomerFeature[]; computedAt: Date } | null>;
}

export interface ICustomerLifecycleRepository {
  saveSnapshot(input: { canonicalCustomerId: string; stage: LifecycleStage | 'UNKNOWN'; policyVersion: number; sourceVersion: number }): Promise<{ created: boolean }>;
  latest(canonicalCustomerId: string): Promise<{ stage: string; policyVersion: number; computedAt: Date } | null>;
}

export interface INbaDecisionRepository {
  /** Idempotent per decisionKey. Persists the decision and its candidate evidence. */
  saveDecision(input: {
    canonicalCustomerId: string;
    profileVersion: number;
    decision: NbaDecision;
    decisionKey: string;
    expiresAt: Date | null;
  }): Promise<{ created: boolean; decisionId: string }>;
  listRecent(canonicalCustomerId: string, limit: number): Promise<{
    id: string; selectedAction: string; selectedTargetRef: string | null; reasonCodes: string[];
    policyVersion: number; activationState: string; createdAt: Date;
    candidates: { actionType: string; targetRef: string | null; eligible: boolean; exclusionReason: string | null; score: number }[];
  }[]>;
}

/** Reads raw first-party signals for a customer from authoritative source systems. */
export interface ICustomerSignalReader {
  readSignals(input: { accountUserId: string | null; identifierKeys: string[] }): Promise<RawCustomerSignals>;
  /** Enumerate distinct order identity signals for backfill (account/email/phone/anon). */
  listOrderIdentitySignals(limit: number, offset: number): Promise<{ signalType: IdentitySignalType; identifierKey: string; accountUserId: string | null; firstSeen: Date; lastSeen: Date }[]>;
}
