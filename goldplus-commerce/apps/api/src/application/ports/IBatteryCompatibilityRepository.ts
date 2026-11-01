import type { CompatEvidenceStatus, CompatWorkflowStatus } from '@goldplus/shared';

export interface CompatClaimRecord {
  id: string;
  productId: string;
  deviceId: string;
  fitType: string;
  confidence: string;
  evidenceStatus: CompatEvidenceStatus;
  workflowStatus: CompatWorkflowStatus;
  evidenceType: string | null;
  evidenceSource: string | null;
  evidenceAssetId: string | null;
  notes: string | null;
  publicCondition: string | null;
  createdBy: string | null;
  submittedBy: string | null;
  submittedAt: Date | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  publishedBy: string | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  sourceImportSessionId: string | null;
  sourceReference: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Joined display facts
  battery: { canonicalCode: string; name: string; slug: string; lifecycleStatus: string };
  device: { brandName: string; model: string; modelNumber: string | null; variant: string | null; slug: string; status: string; label: string };
}

export interface ClaimListFilters {
  productId?: string;
  deviceId?: string;
  workflowStatus?: CompatWorkflowStatus | 'ALL';
  evidenceStatus?: CompatEvidenceStatus;
  limit?: number;
}

export interface ClaimCreateInput {
  productId: string;
  deviceId: string;
  evidenceStatus: CompatEvidenceStatus;
  evidenceType: string | null;
  evidenceSource: string | null;
  notes: string | null;
  publicCondition: string | null;
  fitType: 'exact' | 'universal' | 'adapter_required';
  confidence: 'verified' | 'inferred' | 'declared';
  createdBy: string;
  sourceImportSessionId?: string | null;
  sourceReference?: string | null;
}

export interface ClaimPatch {
  evidenceStatus?: CompatEvidenceStatus;
  workflowStatus?: CompatWorkflowStatus;
  evidenceType?: string | null;
  evidenceSource?: string | null;
  evidenceAssetId?: string | null;
  notes?: string | null;
  publicCondition?: string | null;
  deviceId?: string;
  confidence?: 'verified' | 'inferred' | 'declared';
  submittedBy?: string | null;
  submittedAt?: Date | null;
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
  reviewNote?: string | null;
  publishedBy?: string | null;
  publishedAt?: Date | null;
  archivedAt?: Date | null;
  verifiedBy?: string | null;
  verifiedAt?: Date | null;
}

export interface IBatteryCompatibilityRepository {
  list(filters: ClaimListFilters): Promise<CompatClaimRecord[]>;
  find(id: string): Promise<CompatClaimRecord | null>;
  findPair(productId: string, deviceId: string): Promise<CompatClaimRecord | null>;
  create(input: ClaimCreateInput): Promise<CompatClaimRecord>;
  update(id: string, patch: ClaimPatch): Promise<CompatClaimRecord | null>;
  /** Other claims for the same device that are ready or live (possible conflicts to show the editor). */
  conflictsForDevice(deviceId: string, excludeProductId: string): Promise<Array<{ productId: string; canonicalCode: string; evidenceStatus: string; workflowStatus: string }>>;
  /** Devices already claimed for a battery, for the "add several variants" quick action. */
  deviceIdsForBattery(productId: string): Promise<string[]>;
}
