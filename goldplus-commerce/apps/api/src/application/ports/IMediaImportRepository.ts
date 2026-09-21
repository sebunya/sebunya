import type { ImportPlan, ImportRowStatus, PlanRow, ProductPlan } from '../../domain/media/MediaImportPlanner';
import type { SlotMap } from '../../domain/media/ProductMediaSlotMap';

export type MediaImportStatus = 'PLANNED' | 'APPROVED' | 'REJECTED' | 'APPLYING' | 'APPLIED' | 'PARTIALLY_APPLIED' | 'FAILED';
export type ApplyRowStatus = 'APPLIED' | 'FAILED' | 'NOT_ATTEMPTED' | 'SKIPPED' | 'STALE';

export interface MediaImportSessionRecord {
  id: string;
  name: string;
  status: MediaImportStatus;
  version: number;
  importerVersion: string;
  manifestSha256: string | null;
  manifestFilename: string | null;
  planHash: string;
  totals: Record<string, number>;
  blocking: boolean;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectedReason: string | null;
  appliedBy: string | null;
  appliedAt: Date | null;
  applySummary: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MediaImportRowRecord extends PlanRow {
  id: string;
  sessionId: string;
  expectedRevision: number | null;
  currentMap: SlotMap | null;
  proposedMap: SlotMap | null;
  applyStatus: ApplyRowStatus | null;
  appliedRevision: number | null;
  appliedAt: Date | null;
  error: string | null;
}

export interface IMediaImportRepository {
  create(input: { name: string; plan: ImportPlan; manifestSha256: string | null; manifestFilename: string | null; actorId: string }): Promise<MediaImportSessionRecord>;
  list(limit: number): Promise<MediaImportSessionRecord[]>;
  find(id: string): Promise<MediaImportSessionRecord | null>;
  rows(sessionId: string): Promise<MediaImportRowRecord[]>;
  /** Compare-and-set status transition; null on version mismatch or wrong current status. */
  transition(id: string, expectedVersion: number, from: MediaImportStatus[], patch: Partial<Pick<MediaImportSessionRecord, 'status' | 'approvedBy' | 'approvedAt' | 'rejectedReason' | 'appliedBy' | 'appliedAt' | 'applySummary'>>): Promise<MediaImportSessionRecord | null>;
  markRows(sessionId: string, productId: string, patch: { applyStatus: ApplyRowStatus; appliedRevision?: number | null; error?: string | null; appliedAt?: Date | null }, onlyStatuses?: ImportRowStatus[]): Promise<number>;
  /** Product plans reconstructed from the rows (grouped, with expected revisions). */
  productPlans(sessionId: string): Promise<ProductPlan[]>;
}
