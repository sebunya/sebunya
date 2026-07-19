import { PromotionStatus, PromotionVersionDraft } from '../../domain/pricing/Pricing';

export interface PromotionDefinitionRecord {
  id: string;
  key: string;
  name: string;
  description: string;
  status: PromotionStatus;
  revision: number;
  activeVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PromotionVersionRecord extends PromotionVersionDraft {
  id: string;
  definitionId: string;
  versionNumber: number;
  status: PromotionStatus;
  createdBy: string;
  createdAt: Date;
  submittedAt: Date | null;
  approvedAt: Date | null;
  approvedBy: string | null;
}

export interface PromotionApprovalRecord {
  id: string;
  versionId: string;
  decision: 'APPROVED' | 'REJECTED';
  actorId: string;
  reason: string;
  decidedAt: Date;
}

export interface IPricingRepository {
  createDefinition(input: { key: string; name: string; description: string; actorId: string; version: PromotionVersionDraft }): Promise<{ definition: PromotionDefinitionRecord; version: PromotionVersionRecord }>;
  createVersion(input: { definitionId: string; expectedRevision: number; actorId: string; version: PromotionVersionDraft }): Promise<PromotionVersionRecord | null>;
  findDefinition(id: string): Promise<PromotionDefinitionRecord | null>;
  findVersion(id: string): Promise<PromotionVersionRecord | null>;
  listDefinitions(): Promise<PromotionDefinitionRecord[]>;
  transitionVersion(input: { definitionId: string; versionId: string; expectedRevision: number; from: PromotionStatus; to: PromotionStatus; actorId: string; reason: string; now: Date }): Promise<{ definition: PromotionDefinitionRecord; version: PromotionVersionRecord } | null>;
  listApprovals(versionId: string): Promise<PromotionApprovalRecord[]>;
}
