import type { BatteryImportType } from '@goldplus/shared';
import type { ImportMapping, ProposedAction } from '../../domain/batteries/BatteryImport';

export interface ImportSessionRecord {
  id: string;
  importType: BatteryImportType;
  name: string;
  sourceFilename: string;
  sourceSha256: string;
  sourceSheet: string | null;
  sourceColumns: string[];
  status: string;
  version: number;
  mapping: ImportMapping | null;
  mappingTemplateId: string | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  heldRows: number;
  excludedRows: number;
  appliedRows: number;
  failedRows: number;
  previewDigest: string | null;
  rollbackInfo: Record<string, unknown> | null;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  appliedBy: string | null;
  appliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ImportRowRecord {
  id: string;
  sessionId: string;
  rowNumber: number;
  rowKey: string | null;
  sourceData: Record<string, unknown>;
  normalizedData: Record<string, unknown> | null;
  proposedAction: ProposedAction | 'PENDING';
  validationWarnings: string[];
  validationErrors: string[];
  status: 'PENDING' | 'VALID' | 'INVALID' | 'HELD' | 'EXCLUDED' | 'APPLIED' | 'SKIPPED' | 'FAILED' | 'ROLLED_BACK';
  resolution: string | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  appliedRecordIds: Record<string, string[]> | null;
  beforeSnapshot: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown> | null;
  appliedAt: Date | null;
  error: string | null;
}

export interface MappingTemplateRecord {
  id: string;
  importType: BatteryImportType;
  name: string;
  mapping: ImportMapping;
  createdAt: Date;
}

export interface PreviewRowWrite {
  rowId: string;
  rowKey: string;
  normalizedData: Record<string, unknown> | null;
  proposedAction: ProposedAction;
  warnings: string[];
  errors: string[];
  hold: string | null;
}

export interface IBatteryImportRepository {
  create(input: { importType: BatteryImportType; name: string; sourceFilename: string; sourceSha256: string; sourceSheet: string | null; sourceColumns: string[]; mapping: ImportMapping | null; rows: Record<string, unknown>[]; actorId: string }): Promise<{ session: ImportSessionRecord; existed: boolean }>;
  list(limit: number): Promise<ImportSessionRecord[]>;
  find(id: string): Promise<ImportSessionRecord | null>;
  rows(id: string): Promise<ImportRowRecord[]>;
  events(id: string): Promise<Array<{ id: string; action: string; actorId: string; reason: string; evidence: Record<string, unknown>; createdAt: Date }>>;
  saveMapping(id: string, expectedVersion: number, mapping: ImportMapping, templateId: string | null, actorId: string): Promise<ImportSessionRecord | null>;
  savePreview(id: string, expectedVersion: number, digest: string, rows: PreviewRowWrite[], actorId: string): Promise<ImportSessionRecord | null>;
  resolveRow(sessionId: string, rowId: string, resolution: 'INCLUDE' | 'EXCLUDE' | 'HOLD', note: string | null, override: Record<string, unknown> | null, actorId: string): Promise<{ session: ImportSessionRecord; row: ImportRowRecord } | null>;
  approve(input: { id: string; expectedVersion: number; actorId: string; decision: 'APPROVED' | 'REJECTED'; reason: string }): Promise<ImportSessionRecord | null>;
  beginApply(id: string, expectedVersion: number, actorId: string): Promise<ImportSessionRecord | null>;
  markRowApplied(rowId: string, result: { status: 'APPLIED' | 'SKIPPED' | 'FAILED'; appliedRecordIds: Record<string, string[]> | null; beforeSnapshot: Record<string, unknown> | null; afterSnapshot: Record<string, unknown> | null; error: string | null }): Promise<void>;
  finishApply(id: string, actorId: string): Promise<ImportSessionRecord>;
  beginRollback(id: string, expectedVersion: number, actorId: string, reason: string): Promise<ImportSessionRecord | null>;
  finishRollback(id: string, actorId: string, result: { rolledBack: number; failed: number; info: Record<string, unknown> }): Promise<ImportSessionRecord | null>;
  markRowRolledBack(rowId: string): Promise<void>;
  event(sessionId: string, actorId: string, action: string, reason: string, evidence: Record<string, unknown>): Promise<void>;

  listTemplates(importType: BatteryImportType): Promise<MappingTemplateRecord[]>;
  saveTemplate(importType: BatteryImportType, name: string, mapping: ImportMapping, actorId: string): Promise<MappingTemplateRecord>;
  findTemplate(id: string): Promise<MappingTemplateRecord | null>;
}
