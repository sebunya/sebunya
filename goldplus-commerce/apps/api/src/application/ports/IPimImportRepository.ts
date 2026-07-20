import {
  NormalizedPimProduct,
  PimImportMode,
  PimImportStatus,
  PimMapping,
} from "../../domain/pim/PimImport";

export interface PimImportSessionRecord {
  id: string;
  name: string;
  sourceFilename: string;
  sourceSha256: string;
  mode: PimImportMode;
  status: PimImportStatus;
  version: number;
  mapping: PimMapping | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  createRows: number;
  updateRows: number;
  appliedRows: number;
  failedRows: number;
  previewDigest: string | null;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface PimImportRowRecord {
  id: string;
  sessionId: string;
  rowNumber: number;
  sourceData: Record<string, unknown>;
  normalizedData: NormalizedPimProduct | null;
  validationErrors: string[];
  action: "PENDING" | "CREATE" | "UPDATE" | "SKIP";
  status:
    | "PENDING"
    | "VALID"
    | "INVALID"
    | "APPLIED"
    | "FAILED"
    | "ROLLED_BACK";
  targetProductId: string | null;
  beforeSnapshot: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown> | null;
  error: string | null;
}
export interface PimCatalogueLookup {
  categories: Array<{ id: string; slug: string; name: string }>;
  products: Array<{
    id: string;
    sku: string;
    slug: string;
    catalogueSnapshot: Record<string, unknown>;
  }>;
}

export interface IPimImportRepository {
  create(input: {
    name: string;
    sourceFilename: string;
    sourceSha256: string;
    mode: PimImportMode;
    rows: Record<string, unknown>[];
    actorId: string;
  }): Promise<PimImportSessionRecord>;
  list(): Promise<PimImportSessionRecord[]>;
  find(id: string): Promise<PimImportSessionRecord | null>;
  rows(id: string): Promise<PimImportRowRecord[]>;
  catalogueLookup(): Promise<PimCatalogueLookup>;
  saveMapping(
    id: string,
    expectedVersion: number,
    mapping: PimMapping,
    actorId: string,
  ): Promise<PimImportSessionRecord | null>;
  savePreview(
    id: string,
    expectedVersion: number,
    previewDigest: string,
    rows: Array<{
      rowId: string;
      normalizedData: NormalizedPimProduct | null;
      validationErrors: string[];
      action: "CREATE" | "UPDATE" | "SKIP";
      targetProductId: string | null;
      beforeSnapshot: Record<string, unknown> | null;
    }>,
    actorId: string,
  ): Promise<PimImportSessionRecord | null>;
  approve(input: {
    id: string;
    expectedVersion: number;
    actorId: string;
    decision: "APPROVED" | "REJECTED";
    reason: string;
  }): Promise<PimImportSessionRecord | null>;
  beginApply(
    id: string,
    expectedVersion: number,
    actorId: string,
  ): Promise<PimImportSessionRecord | null>;
  applyRow(
    row: PimImportRowRecord,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  finishApply(id: string, actorId: string): Promise<PimImportSessionRecord>;
  rollback(
    id: string,
    expectedVersion: number,
    actorId: string,
    reason: string,
  ): Promise<PimImportSessionRecord | null>;
  events(id: string): Promise<Array<Record<string, unknown>>>;
}
