import {
  DecisionSignalType, DecisionPolicy, EvidenceInput, DecisionEvidence, DecisionSeverity,
  DecisionConfidence, DecisionStatus, DecisionCategory, DecisionRecommendationType, DecisionResolutionCode,
} from '../../domain/decision-intelligence/DecisionIntelligence';

/** Reads real persisted data into uniform evidence for one signal. */
export interface IDecisionEvidenceReader {
  readEvidence(signalType: DecisionSignalType, policy: DecisionPolicy, now: Date): Promise<EvidenceInput>;
}

export interface InsightUpsert {
  idempotencyKey: string;
  category: DecisionCategory;
  signalType: DecisionSignalType;
  subject: string;
  subjectRef: string | null;
  windowKey: string;
  severity: DecisionSeverity;
  confidence: DecisionConfidence;
  recommendation: DecisionRecommendationType;
  title: string;
  summary: string;
  score: number;
  evidence: DecisionEvidence;
  reasonCodes: string[];
}

export type UpsertResult =
  | { kind: 'created'; insightId: string }
  | { kind: 'updated'; insightId: string }
  | { kind: 'unchanged'; insightId: string };

export interface InsightListFilters {
  category?: string; severity?: string; confidence?: string; status?: string;
  assignedTo?: string | 'unassigned'; limit: number; offset: number;
}

export interface InsightRow {
  id: string; idempotencyKey: string; category: string; signalType: string; subject: string; subjectRef: string | null;
  severity: string; confidence: string; status: string; recommendation: string; title: string; summary: string;
  score: number; currentValue: number; baselineValue: number; delta: number; sampleSize: number; freshestAt: Date | null;
  policyVersion: number; version: number; assignedTo: string | null; assignedTeam: string | null; resolutionCode: string | null;
  generatedAt: Date; acknowledgedAt: Date | null; resolvedAt: Date | null; createdAt: Date; updatedAt: Date;
}

export interface InsightDetail extends InsightRow {
  evidence: DecisionEvidence[];
  events: { eventType: string; actorId: string | null; fromStatus: string | null; toStatus: string | null; reason: string | null; createdAt: Date }[];
  recommendations: { recommendationType: string; handoffState: string | null; createdAt: Date }[];
}

export interface StatusTransition {
  insightId: string; expectedVersion: number; toStatus: DecisionStatus;
  actorId: string; eventType: string; reason?: string | null;
  assignedTo?: string | null; assignedTeam?: string | null; resolutionCode?: DecisionResolutionCode | null;
  correlationId?: string | null;
}

export interface DecisionOverview {
  open: number; criticalHigh: number; stale: number; unassigned: number; resolvedToday: number;
  byCategory: Record<string, number>; bySeverity: Record<string, number>;
  byOwner: { assignedTo: string | null; count: number }[];
  avgAcknowledgementHours: number | null; avgResolutionHours: number | null;
}

export interface IDecisionInsightRepository {
  /** Idempotent by idempotency_key: create, update-in-place (non-terminal, material change), or unchanged. */
  upsertOnEvaluation(input: InsightUpsert, now: Date): Promise<UpsertResult>;
  findDetail(id: string): Promise<InsightDetail | null>;
  list(filters: InsightListFilters): Promise<{ items: InsightRow[]; total: number }>;
  /** Optimistic status/assignment transition; false on stale version. Writes a decision_event. */
  transition(input: StatusTransition): Promise<{ ok: true; version: number } | { ok: false; code: 'STALE' | 'NOT_FOUND' }>;
  /** Eligibility of a proposed owner — must be a real active user. */
  isOwnerEligible(userId: string): Promise<boolean>;
  overview(now: Date): Promise<DecisionOverview>;
}
