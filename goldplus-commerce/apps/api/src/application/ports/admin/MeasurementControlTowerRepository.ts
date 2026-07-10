export type DashboardStatus = 'DASHBOARD_READY' | 'SECTION_READY' | 'NO_DATA_AVAILABLE' | 'ACCESS_DENIED' | 'INVALID_SECTION' | 'REDACTED' | 'CONSENT_BLOCKED' | 'DRY_RUN' | 'NOT_CONFIGURED' | 'DATA_QUALITY_WARNING' | 'FAILED';

export interface MeasurementHealthSummary {
  totalSafeEvents: number;
  eventsQueued: number;
  eventsFailed: number;
  eventsBlockedByConsent: number;
  dryRunEvents: number;
  lastEventReceived: Date | null;
  lastQueueError: string | null;
  measurementQueueStatus: string;
}

export interface ConsentSafetySummary {
  advertisingConsentGranted: number;
  advertisingConsentWithdrawn: number;
  analyticsConsentGranted: number;
  personalisationConsentGranted: number;
  eventsBlockedByAdvertisingOptOut: number;
  eventsBlockedByMissingConsent: number;
  preferenceUpdatesAudited: number;
}

export interface ProductFinderSummary {
  finderSessionsStarted: number;
  finderSessionsCompleted: number;
  completionRate: number;
  noMatchSessions: number;
  topRequestedCategories: string[];
  topProblemsSelected: string[];
  topBuyingContexts: string[];
  whatsappIntentClicks: number;
  addToCartIntentClicks: number;
}

export interface PreferenceCentreSummary {
  preferencesViewed: number;
  preferencesUpdated: number;
  communicationOptIns: number;
  communicationOptOuts: number;
  whatsappOptIns: number;
  whatsappOptOuts: number;
  productInterestsSaved: number;
  lastPreferenceAuditEvent: Date | null;
}

export interface PaymentReconciliationSummary {
  verifiedPurchaseConversions: number;
  pendingReconciliations: number;
  failedReconciliations: number;
  duplicateCallbacksHandled: number;
  retryableFailures: number;
  lastVerifiedPayment: Date | null;
  lastReconciliationError: string | null;
}

export interface PaidSocialReadinessSummary {
  eventsEligibleForRouting: number;
  eventsBlockedByConsent: number;
  eventsBlockedByMissingIdentifiers: number;
  dryRunRoutedEvents: number;
  destinationPayloadsPrepared: number;
  destinationFailures: number;
  metaReadiness: string;
  googleAdsReadiness: string;
  tiktokReadiness: string;
  pinterestReadiness: string;
  linkedInReadiness: string;
  snapchatReadiness: string;
  xReadiness: string;
  postHogReadiness: string;
}

export interface GtmAutomationSummary {
  gtmCredentialsStatus: string;
  lastPlanStatus: string;
  lastValidateStatus: string;
  lastDiffStatus: string;
  lastWorkspaceDraftStatus: string;
  lastVersionDraftStatus: string;
  publishStatus: string;
}

export type WarningSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface DataQualityWarning {
  id: string;
  timestamp: Date;
  severity: WarningSeverity;
  area: string;
  issue: string;
  status: string;
  suggestedNextAction: string;
  safeReferenceId: string;
}

export interface RecentRedactedEvent {
  id: string;
  timestamp: Date;
  source: string;
  type: string;
  status: string;
  redactedPayload: Record<string, any>;
}

export interface MeasurementControlTowerSummary {
  status: DashboardStatus;
  health: MeasurementHealthSummary;
  consent: ConsentSafetySummary;
  productFinder: ProductFinderSummary;
  preferenceCentre: PreferenceCentreSummary;
  paymentReconciliation?: PaymentReconciliationSummary;
  paidSocialReadiness: PaidSocialReadinessSummary;
  gtmAutomation?: GtmAutomationSummary;
  warnings?: DataQualityWarning[];
}

export interface IMeasurementControlTowerRepository {
  getMeasurementHealthSummary(): Promise<MeasurementHealthSummary>;
  getConsentSafetySummary(): Promise<ConsentSafetySummary>;
  getProductFinderSummary(): Promise<ProductFinderSummary>;
  getPreferenceCentreSummary(): Promise<PreferenceCentreSummary>;
  getPaymentReconciliationSummary(): Promise<PaymentReconciliationSummary>;
  getPaidSocialReadinessSummary(): Promise<PaidSocialReadinessSummary>;
  getGtmAutomationSummary(): Promise<GtmAutomationSummary>;
  getDataQualityWarnings(limit?: number): Promise<DataQualityWarning[]>;
  getAdminReviewQueue(limit?: number): Promise<DataQualityWarning[]>;
  getRecentRedactedEvents(limit?: number, filters?: any): Promise<RecentRedactedEvent[]>;
}
