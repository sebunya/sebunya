import { FraudCaseStatus, FraudDecision, FraudPriority, FraudSignalInput, FraudSourceType } from '../../domain/fraud/FraudTriage';

export interface FraudCaseRecord {
  id: string; referenceKey: string; sourceType: FraudSourceType; sourceRef: string; subjectRefHash: string | null;
  status: FraudCaseStatus; priority: FraudPriority; assignedTo: string | null; version: number;
  finalDecision: Exclude<FraudDecision, 'REVIEW'> | null; resolvedAt: Date | null; createdAt: Date; updatedAt: Date;
}
export interface FraudSignalRecord { id: string; caseId: string; signalKey: string; signalType: string; severity: FraudPriority; reasonCode: string; evidence: Record<string, unknown>; createdAt: Date }
export interface FraudCaseEventRecord { id: string; caseId: string; action: string; actorId: string | null; reason: string; evidence: Record<string, unknown>; createdAt: Date }

export class FraudTriageRepositoryError extends Error {
  constructor(public readonly code: 'CASE_RESOLVED' | 'REFERENCE_COLLISION', message: string) { super(message); }
}

export interface IFraudTriageRepository {
  recordSignal(input: FraudSignalInput, actorId: string): Promise<{ fraudCase: FraudCaseRecord; signal: FraudSignalRecord; duplicate: boolean }>;
  list(filters?: { status?: FraudCaseStatus; assignedTo?: string }): Promise<FraudCaseRecord[]>;
  find(id: string): Promise<FraudCaseRecord | null>;
  signals(id: string): Promise<FraudSignalRecord[]>;
  events(id: string): Promise<FraudCaseEventRecord[]>;
  assign(input: { id: string; expectedVersion: number; assigneeId: string; actorId: string; reason: string }): Promise<FraudCaseRecord | null>;
  decide(input: { id: string; expectedVersion: number; decision: FraudDecision; actorId: string; reason: string; evidence: Record<string, unknown> }): Promise<FraudCaseRecord | null>;
  overview(): Promise<{ byStatus: Record<string, number>; byPriority: Record<string, number>; unassigned: number }>;
}
