import { PromotionApprovalRecord, PromotionDefinitionRecord, PromotionVersionRecord } from './IPricingRepository';

export interface PricingCapacitySummary {
  definitionId: string;
  definitionName: string;
  versionId: string;
  versionNumber: number;
  globalLimit: number | null;
  reserved: number;
  redeemed: number;
  remaining: number | null;
}

export interface PricingOperationsOverview {
  definitionsByStatus: Record<string, number>;
  reservationsByStatus: Record<string, number>;
  quoteCount: number;
  redemptionCount: number;
  activeCapacity: PricingCapacitySummary[];
}

export interface PricingExperimentAssociation {
  promotionVersionId: string;
  experimentId: string;
  experimentKey: string;
  variantKey: string;
}

export interface PricingAuditSummary {
  id: string;
  actorId: string | null;
  action: string;
  createdAt: Date;
}

export interface PricingOperationsDetail {
  definition: PromotionDefinitionRecord;
  versions: PromotionVersionRecord[];
  approvals: PromotionApprovalRecord[];
  associations: PricingExperimentAssociation[];
  capacity: PricingCapacitySummary[];
  audit: PricingAuditSummary[];
}

export interface IPricingOperationsRepository {
  overview(): Promise<PricingOperationsOverview>;
  detail(definitionId: string): Promise<PricingOperationsDetail | null>;
  associateExperiment(input: { definitionId: string; versionId: string; experimentId: string; variantKey: string }): Promise<'CREATED' | 'DUPLICATE' | 'NOT_FOUND' | 'VERSION_IMMUTABLE' | 'EXPERIMENT_NOT_READY'>;
}
