import './logging/appLoggerBinding';
import { createHmac } from 'node:crypto';
import { db } from './db/client';
import { DrizzleCartRepository } from './db/repositories/DrizzleCartRepository';
import { DrizzleCartQueryRepository } from './db/repositories/DrizzleCartQueryRepository';
import { DrizzleOrderRepository } from './db/repositories/DrizzleOrderRepository';
import { DrizzleProductRepository } from './db/repositories/DrizzleProductRepository';
import { DrizzleDeviceRepository } from './db/repositories/DrizzleDeviceRepository';
import { DrizzlePricingRepository } from './db/repositories/DrizzlePricingRepository';
import { DrizzlePricingQuoteRepository } from './db/repositories/DrizzlePricingQuoteRepository';
import { DrizzlePricingCapacityRepository } from './db/repositories/DrizzlePricingCapacityRepository';
import { DrizzleCouponRepository } from './db/repositories/DrizzleCouponRepository';
import { DrizzleReviewRepository } from './db/repositories/DrizzleReviewRepository';
import { SubmitReviewUseCase } from '../application/use-cases/reviews/SubmitReviewUseCase';
import { DrizzleCreatorRepository } from './db/repositories/DrizzleCreatorRepository';
import { DrizzleFlashSaleRepository } from './db/repositories/DrizzleFlashSaleRepository';
import { DrizzleSeoRepository } from './db/repositories/DrizzleSeoRepository';
import { NoSendMobileMoneyDisbursement } from '../application/ports/IMobileMoneyDisbursement';
import { DrizzlePricingOperationsRepository } from './db/repositories/DrizzlePricingOperationsRepository';
import { DrizzleDealerRepository } from './db/repositories/DrizzleDealerRepository';
import { DrizzleSupportRepository } from './db/repositories/DrizzleSupportRepository';
import { DrizzleQuoteRepository } from './db/repositories/DrizzleQuoteRepository';
import { DrizzleVerificationRepository } from './db/repositories/DrizzleVerificationRepository';
import { DrizzleAuditRepository } from './db/repositories/DrizzleAuditRepository';
import { DrizzlePaymentRepository } from './db/repositories/DrizzlePaymentRepository';
import { DrizzleUserRepository } from './db/repositories/DrizzleUserRepository';
import { LocalProductImageStorage } from './storage/LocalProductImageStorage';
import { DrizzleMediaLibraryRepository } from './db/repositories/DrizzleMediaLibraryRepository';
import { DrizzleLegalCmsRepository } from './db/repositories/DrizzleLegalCmsRepository';
import { LegalCmsUseCase } from '../application/use-cases/legal/LegalCmsUseCase';
import { DrizzleAbandonmentRepository } from './db/repositories/DrizzleAbandonmentRepository';
import { DrizzleStockAdjustmentRepository } from './db/repositories/DrizzleStockAdjustmentRepository';
import { DrizzleNotificationTemplateRepository } from './db/repositories/DrizzleNotificationTemplateRepository';
import { DrizzleCampaignRepository } from './db/repositories/DrizzleCampaignRepository';
import { DrizzleCampaignSendRepository } from './db/repositories/DrizzleCampaignSendRepository';
import { DrizzleGamificationRepository } from './db/repositories/DrizzleGamificationRepository';
import { DrizzleAdminUserWriteRepository } from './db/repositories/DrizzleAdminUserWriteRepository';
import { AdminUserManagementUseCase } from '../application/use-cases/identity/AdminUserManagementUseCase';
import { CampaignSendEngineUseCase } from '../application/use-cases/campaigns/CampaignSendEngineUseCase';
import { AdjustStockUseCase } from '../application/use-cases/inventory/AdjustStockUseCase';
import { AbandonmentUseCase } from '../application/use-cases/abandonment/AbandonmentUseCase';
import { QueueService, QUEUES } from './queues/QueueService';
import { MediaLibraryUseCase } from '../application/use-cases/media/MediaLibraryUseCase';
import { SharpVariantGenerator } from './media/SharpVariantGenerator';
import * as path from 'path';
import { DrizzleAddressRepository } from './db/repositories/DrizzleAddressRepository';
import { DrizzleRoleRepository } from './db/repositories/DrizzleRoleRepository';
import { DrizzleFakeReportRepository } from './db/repositories/DrizzleFakeReportRepository';
import { DrizzleAdminRoleReadRepository } from './db/repositories/DrizzleAdminRoleReadRepository';
import { DrizzleAdminUserReadRepository } from './db/repositories/DrizzleAdminUserReadRepository';
import { DrizzleProductImageRepository } from './db/repositories/DrizzleProductImageRepository';
import { DrizzleAttributeRepository } from './db/repositories/DrizzleAttributeRepository';
import { DrizzleNotificationAttemptRepository } from './db/repositories/DrizzleNotificationAttemptRepository';
import { DrizzleOutboxRepository } from './db/repositories/DrizzleOutboxRepository';
import { DrizzleRecommendationEventRepository } from './db/repositories/DrizzleRecommendationEventRepository';
import { DrizzleRecommendationRuleAuditRepository } from './db/repositories/DrizzleRecommendationRuleAuditRepository';
import { DrizzleRecommendationRuleRepository } from './db/repositories/DrizzleRecommendationRuleRepository';
import { RecommendationRuleConflictService } from '../application/recommendations/RecommendationRuleConflictService';
import { RecommendationRuleApplicationService } from '../application/recommendations/RecommendationRuleApplicationService';
import { DrizzleRecommendationAnalyticsRepository } from './db/repositories/DrizzleRecommendationAnalyticsRepository';
import { RecommendationAnalyticsService } from '../application/recommendations/RecommendationAnalyticsService';

import { DrizzleProductRecommendationReader } from './db/repositories/DrizzleProductRecommendationReader';
import { ScryptPasswordHasher } from './security/ScryptPasswordHasher';
import { Hs256TokenSigner } from './security/Hs256TokenSigner';

import { DrizzlePaymentAttemptRepository } from './db/repositories/DrizzlePaymentAttemptRepository';
import { PesaPalClient } from './payments/pesapal/PesaPalClient';
import { IPesaPalClient } from '../application/ports/IPesaPalClient';
import { StartPesaPalPaymentUseCase } from '../application/use-cases/payments/StartPesaPalPaymentUseCase';
import { GetPaymentReconciliationUseCase } from '../application/use-cases/payments/GetPaymentReconciliationUseCase';
import { DrizzleSearchDemandRepository } from './db/repositories/DrizzleSearchDemandRepository';
import { DrizzleCompatibilityMappingRepository } from './db/repositories/DrizzleCompatibilityMappingRepository';
import { DrizzleLoyaltyRepository } from './db/repositories/DrizzleLoyaltyRepository';
import { GetSupportInboxUseCase, UpdateSupportTicketUseCase } from '../application/use-cases/governance/SupportInboxUseCases';
import { DrizzleLifecycleReadRepository } from './db/repositories/DrizzleLifecycleReadRepository';
import { GetLifecycleSegmentsUseCase } from '../application/use-cases/identity/GetLifecycleSegmentsUseCase';
import { InMemoryLoginAttemptStore } from './security/InMemoryLoginAttemptStore';
import {
  LoyaltyProgrammeGate,
  EarnLoyaltyPointsUseCase,
  RedeemLoyaltyPointsUseCase,
  ExpireLoyaltyPointsUseCase,
  ReverseLoyaltyEntryUseCase,
  GetLoyaltyHistoryUseCase,
  GetLoyaltyOperationsUseCase,
  GetLoyaltyConfigUseCase,
  SaveLoyaltyConfigUseCase,
} from '../application/use-cases/loyalty/LoyaltyUseCases';
import {
  UpsertCompatibilityMappingUseCase,
  ListCompatibilityMappingsUseCase,
  DeleteCompatibilityMappingUseCase,
  GetProductCompatibilityUseCase,
} from '../application/use-cases/products/CompatibilityUseCases';
import {
  SuggestProductsUseCase,
  RecordSearchEventUseCase,
  RecordSearchInteractionUseCase,
  ListSearchDemandUseCase,
  GetSearchInsightsUseCase,
  UpdateSearchDemandStatusUseCase,
} from '../application/use-cases/products/SearchUseCases';
import { VerifyPesaPalPaymentUseCase } from '../application/use-cases/payments/VerifyPesaPalPaymentUseCase';
import { env } from '../config/env';
import { DrizzleSystemHealthRepository } from './db/repositories/DrizzleSystemHealthRepository';
import { CheckSystemHealthUseCase } from '../application/use-cases/system/CheckSystemHealthUseCase';
import { SyntheticMonitor } from './scheduler/SyntheticMonitor';
import { RecommendationMaterializer } from './scheduler/RecommendationMaterializer';

import { WhatsAppAdapter } from './notifications/whatsapp/WhatsAppAdapter';
import { ZeptoMailAdapter } from './notifications/zeptomail/ZeptoMailAdapter';
import { DisabledSmsAdapter } from './notifications/sms/DisabledSmsAdapter';
import { PahappaCommsSmsAdapter } from './notifications/sms/PahappaCommsSmsAdapter';
import { DefaultNotificationRouter } from './notifications/NotificationRouter';

import { ProductSignalExtractor } from '../application/recommendations/ProductSignalExtractor';
import { CompatibilityRuleService } from '../application/recommendations/CompatibilityRuleService';
import { RecommendationScoringService } from '../application/recommendations/RecommendationScoringService';
import { TrendingScoreService } from '../application/recommendations/TrendingScoreService';
import { RecommendationFallbackService } from '../application/recommendations/RecommendationFallbackService';
import { RecommendationEligibilityService } from '../application/recommendations/RecommendationEligibilityService';
import { RecommendationDeduplicationService } from '../application/recommendations/RecommendationDeduplicationService';
import { RecommendationDiversityService } from '../application/recommendations/RecommendationDiversityService';

import { AddToCartUseCase } from '../application/use-cases/commerce/AddToCartUseCase';
import { GetCartByIdUseCase } from '../application/use-cases/commerce/GetCartByIdUseCase';
import { CheckoutUseCase } from '../application/use-cases/commerce/CheckoutUseCase';
import { EvaluateCartPricingUseCase } from '../application/use-cases/pricing/EvaluateCartPricingUseCase';
import { ManagePromotionCapacityUseCase } from '../application/use-cases/pricing/ManagePromotionCapacityUseCase';
import { RedeemCouponUseCase } from '../application/use-cases/pricing/RedeemCouponUseCase';
import { FirstOrderEligibilityUseCase } from '../application/use-cases/pricing/FirstOrderEligibilityUseCase';
import { PricingGovernanceUseCase } from '../application/use-cases/pricing/PricingGovernanceUseCase';
import { PricingOperationsUseCase } from '../application/use-cases/pricing/PricingOperationsUseCase';
import { DrizzleDeliveryZoneRepository } from './db/repositories/DrizzleDeliveryZoneRepository';
import {
  DrizzleDeliveryPricingPolicyRepository,
  DrizzleDeliveryFeeObservationReader,
} from './db/repositories/DrizzleDeliveryIntelligenceRepositories';
import {
  GetDeliveryEstimateUseCase,
  GetDeliveryIntelligenceUseCase,
  SaveDeliveryPricingPolicyUseCase,
} from '../application/use-cases/commerce/DeliveryIntelligenceUseCases';
import { LocationSearchService } from '../application/services/locations/LocationSearchService';
import { SearchLocationsUseCase, RecordLocationSearchEventUseCase, ResolveMapLinkUseCase } from '../application/use-cases/locations/LocationUseCases';
import { DrizzleAddressAuditRepository } from './db/repositories/DrizzleAddressAuditRepository';
import { DrizzleLocationSearchRepository, DrizzleLocationOrderDensityReader, DrizzleSearchMissRecorder, DrizzleCustomerLocationContextReader } from './db/repositories/DrizzleLocationSearchRepository';
import { HttpShortLinkResolver } from './locations/HttpShortLinkResolver';
import { DrizzleLocationAdminRepository } from './db/repositories/DrizzleLocationAdminRepository';
import { CodPolicyReader, CheckoutVelocitySignal } from './locations/CodPolicyReader';
import { DrizzleLoyaltyCompletionRepository } from './db/repositories/DrizzleLoyaltyCompletionRepository';
import { LoyaltyOutboxNotifier } from './loyalty/LoyaltyOutboxNotifier';
import { VestLoyaltyOnDeliveryUseCase, ClawbackOrderEarnUseCase, ReserveRedemptionUseCase, ConsumeRedemptionUseCase, ReleaseRedemptionUseCase, ReverseRedemptionUseCase, RunLoyaltyDailySweepUseCase } from '../application/use-cases/loyalty/LoyaltyCompletionUseCases';
import { ListSearchMissesUseCase, PromoteSearchMissToAliasUseCase, ListAddressReviewQueueUseCase, ResolveAddressUseCase, ManageLandmarksUseCase, ManagePickupPointsUseCase, GetZonePoliciesUseCase, SaveZonePolicyUseCase, ListDataExceptionsUseCase } from '../application/use-cases/locations/LocationAdminUseCases';
import {
  ListDeliveryZonesUseCase,
  UpsertDeliveryZoneUseCase,
  DeleteDeliveryZoneUseCase,
} from '../application/use-cases/commerce/DeliveryZoneAdminUseCases';
import { VerificationCheckUseCase } from '../application/use-cases/VerificationCheckUseCase';
import { DealerApplicationUseCase } from '../application/use-cases/DealerApplicationUseCase';
import { GetProductListUseCase } from '../application/use-cases/commerce/GetProductListUseCase';
import { GetOrderListUseCase } from '../application/use-cases/commerce/GetOrderListUseCase';
import { GetOrderByIdUseCase } from '../application/use-cases/commerce/GetOrderByIdUseCase';
import { ListAdminUsersUseCase } from '../application/use-cases/admin/ListAdminUsersUseCase';
import { ListAdminRolesUseCase } from '../application/use-cases/admin/ListAdminRolesUseCase';
import { RecordNotificationAttemptUseCase } from '../application/use-cases/notifications/RecordNotificationAttemptUseCase';
import { ListRecentNotificationsUseCase } from '../application/use-cases/notifications/ListRecentNotificationsUseCase';
import { ListOrderNotificationsUseCase } from '../application/use-cases/notifications/ListOrderNotificationsUseCase';
import { ProcessOutboxBatchUseCase } from '../application/use-cases/outbox/ProcessOutboxBatchUseCase';
import { EnqueueAdminOrderEmailUseCase } from '../application/use-cases/notifications/EnqueueAdminOrderEmailUseCase';
import { ReplayAdminOrderEmailUseCase } from '../application/use-cases/notifications/ReplayAdminOrderEmailUseCase';
import { UploadProductImagesUseCase } from '../application/use-cases/products/UploadProductImagesUseCase';
import { TrackRecommendationEventUseCase } from '../application/recommendations/TrackRecommendationEventUseCase';
import { GetRecommendationsUseCase } from '../application/recommendations/GetRecommendationsUseCase';
import { GetRecentlyViewedUseCase } from '../application/recommendations/GetRecentlyViewedUseCase';

import { DrizzleMeasurementAdminRepository } from './measurement/DrizzleMeasurementAdminRepository';
import { DrizzleDlqRepository } from './measurement/DrizzleDlqRepository';
import { DrizzleAttributionRepository } from './measurement/DrizzleAttributionRepository';
import { DrizzleConsentReadRepository } from './measurement/DrizzleConsentReadRepository';
import { PinoMeasurementLogger } from './measurement/PinoMeasurementLogger';
import { DrizzleZeroPartyDataRepository } from './measurement/DrizzleZeroPartyDataRepository';
import { DrizzleConsentRepository } from './measurement/DrizzleConsentRepository';

import { GetMeasurementOverviewUseCase } from '../application/use-cases/measurement/GetMeasurementOverviewUseCase';
import { ListMeasurementDlqUseCase } from '../application/use-cases/measurement/ListMeasurementDlqUseCase';
import { ReplayMeasurementDlqUseCase } from '../application/use-cases/measurement/ReplayMeasurementDlqUseCase';
import { ListConsentAuditUseCase } from '../application/use-cases/measurement/ListConsentAuditUseCase';
import { GetMatchQualitySummaryUseCase } from '../application/use-cases/measurement/GetMatchQualitySummaryUseCase';
import { AttributionService } from '../application/use-cases/measurement/AttributionService';
import { CaptureZeroPartyDataUseCase } from '../application/use-cases/measurement/CaptureZeroPartyDataUseCase';
import { ConsentService } from '../application/use-cases/measurement/ConsentService';

import { GoogleTagManagerRepository } from './measurement/GoogleTagManagerRepository';
import { DrizzleGtmPlanRepository } from './measurement/DrizzleGtmPlanRepository';
import { GtmPlanBuilder } from '../application/services/measurement/GtmPlanBuilder';
import { GtmDiffService } from '../application/services/measurement/GtmDiffService';
import { PlanGtmMeasurementChangesUseCase } from '../application/use-cases/measurement/PlanGtmMeasurementChangesUseCase';
import { ValidateGtmMeasurementPlanUseCase } from '../application/use-cases/measurement/ValidateGtmMeasurementPlanUseCase';
import { CreateGtmWorkspaceUseCase } from '../application/use-cases/measurement/CreateGtmWorkspaceUseCase';
import { CreateGtmVersionDraftUseCase } from '../application/use-cases/measurement/CreateGtmVersionDraftUseCase';
import { ListGtmSyncLogsUseCase } from '../application/use-cases/measurement/ListGtmSyncLogsUseCase';
import { ListGtmWorkspacesUseCase } from '../application/use-cases/measurement/ListGtmWorkspacesUseCase';

import { DrizzlePaidSocialDestinationRepository } from './measurement/DrizzlePaidSocialDestinationRepository';
import { DrizzlePaidSocialDeliveryRepository } from './measurement/DrizzlePaidSocialDeliveryRepository';
import { EnvPaidSocialCredentialStatusRepository } from './measurement/EnvPaidSocialCredentialStatusRepository';
import { RoutePaidSocialEventUseCase } from '../application/use-cases/measurement/RoutePaidSocialEventUseCase';
import { PreparePaidSocialPayloadUseCase } from '../application/use-cases/measurement/PreparePaidSocialPayloadUseCase';
import { DeliverPaidSocialEventUseCase } from '../application/use-cases/measurement/DeliverPaidSocialEventUseCase';
import { BlockMeasurementEventUseCase } from '../application/use-cases/measurement/BlockMeasurementEventUseCase';
import { ListPaidSocialDestinationsUseCase } from '../application/use-cases/measurement/ListPaidSocialDestinationsUseCase';
import { GetPaidSocialDeliveryHealthUseCase } from '../application/use-cases/measurement/GetPaidSocialDeliveryHealthUseCase';
import { RetryPaidSocialDeliveryUseCase } from '../application/use-cases/measurement/RetryPaidSocialDeliveryUseCase';
import { UpdatePaidSocialDestinationUseCase } from '../application/use-cases/measurement/UpdatePaidSocialDestinationUseCase';
import { Sha256MeasurementHashingService } from '../application/services/measurement/Sha256MeasurementHashingService';
import { PaidSocialPayloadMapper } from '../application/services/measurement/PaidSocialPayloadMapper';
import { PaidSocialPayloadRedactor } from '../application/services/measurement/PaidSocialPayloadRedactor';
import { BullMQMeasurementQueueAdapter } from './measurement/BullMQMeasurementQueueAdapter';

import { PaidSocialDestinationMapperRegistry } from './measurement/destinations/PaidSocialDestinationMapperRegistry';
import { MetaCapiMapper } from './measurement/destinations/MetaCapiMapper';
import { TikTokEventsMapper } from './measurement/destinations/TikTokEventsMapper';
import { XConversionMapper } from './measurement/destinations/XConversionMapper';
import { LinkedInConversionMapper } from './measurement/destinations/LinkedInConversionMapper';
import { PinterestConversionMapper } from './measurement/destinations/PinterestConversionMapper';
import { SnapchatConversionMapper } from './measurement/destinations/SnapchatConversionMapper';
import { GoogleAdsMeasurementMapper } from './measurement/destinations/GoogleAdsMeasurementMapper';
import { PostHogMeasurementMapper } from './measurement/destinations/PostHogMeasurementMapper';

import { DrizzlePaymentMeasurementRepository } from './measurement/DrizzlePaymentMeasurementRepository';
import { DrizzlePaymentAttributionRepository } from './measurement/DrizzlePaymentAttributionRepository';
import { GetCustomerPreferenceCentreUseCase } from '../application/use-cases/preferences/GetCustomerPreferenceCentreUseCase';
import { UpdateCustomerPreferenceCentreUseCase } from '../application/use-cases/preferences/UpdateCustomerPreferenceCentreUseCase';
import { RecordPreferenceConsentChangeUseCase } from '../application/use-cases/preferences/RecordPreferenceConsentChangeUseCase';
import { GetPreferenceAuditTrailUseCase } from '../application/use-cases/preferences/GetPreferenceAuditTrailUseCase';
import { DrizzleCustomerPreferenceRepository } from './preferences/DrizzleCustomerPreferenceRepository';
import { DrizzlePreferenceAuditRepository } from './preferences/DrizzlePreferenceAuditRepository';
import { MeasurementPreferencePublisher } from './preferences/MeasurementPreferencePublisher';
import { BullMqPurchaseMeasurementQueue } from './measurement/BullMqPurchaseMeasurementQueue';
import { BullMqGenericMeasurementQueue } from './measurement/BullMqGenericMeasurementQueue';
import { PesapalMeasurementMapper } from './measurement/PesapalMeasurementMapper';
import { PaymentMeasurementRedactor } from './measurement/PaymentMeasurementRedactor';

import { CapturePurchaseMeasurementUseCase } from '../application/use-cases/measurement/CapturePurchaseMeasurementUseCase';
import { LinkPaymentToAttributionTouchpointsUseCase } from '../application/use-cases/measurement/LinkPaymentToAttributionTouchpointsUseCase';
import { ReconcilePesapalOrderMeasurementUseCase } from '../application/use-cases/measurement/ReconcilePesapalOrderMeasurementUseCase';
import { GetPaymentMeasurementReconciliationUseCase } from '../application/use-cases/measurement/GetPaymentMeasurementReconciliationUseCase';
import { ListPaymentMeasurementReconciliationsUseCase } from '../application/use-cases/measurement/ListPaymentMeasurementReconciliationsUseCase';
import { RetryPaymentMeasurementReconciliationUseCase } from '../application/use-cases/measurement/RetryPaymentMeasurementReconciliationUseCase';
import { ConsentAwareMeasurementPolicy } from '../application/services/measurement/ConsentAwareMeasurementPolicy';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';
import { DrizzleExperimentRepository } from './db/repositories/DrizzleExperimentRepository';
import { ExperimentOperationsUseCase } from '../application/use-cases/experiments/ExperimentOperationsUseCase';
import { DrizzleFraudTriageRepository } from './db/repositories/DrizzleFraudTriageRepository';
import { FraudTriageOperationsUseCase } from '../application/use-cases/fraud/FraudTriageOperationsUseCase';
import { DrizzlePimImportRepository } from './db/repositories/DrizzlePimImportRepository';
import { PimImportOperationsUseCase } from '../application/use-cases/pim/PimImportOperationsUseCase';
import { DrizzleSurveyRepository } from './db/repositories/DrizzleSurveyRepository';
import { SurveyOperationsUseCase } from '../application/use-cases/surveys/SurveyOperationsUseCase';
import { DrizzleCopyQualityCatalogReader } from './db/repositories/DrizzleCopyQualityCatalogReader';
import { GetCopyQualityReportUseCase } from '../application/use-cases/copy-quality/GetCopyQualityReportUseCase';
import { DrizzleBehaviouralInterventionRepository } from './db/repositories/DrizzleBehaviouralInterventionRepository';
import { BehaviouralInterventionOperationsUseCase } from '../application/use-cases/behavioural-interventions/BehaviouralInterventionOperationsUseCase';

import { DrizzleProductFinderRepository } from './product-finder/DrizzleProductFinderRepository';
import { DrizzleProductFinderCatalogRepository } from './product-finder/DrizzleProductFinderCatalogRepository';
import { MeasurementProductFinderPublisher } from './product-finder/MeasurementProductFinderPublisher';
import { PreferenceProductFinderUpdater } from './product-finder/PreferenceProductFinderUpdater';
import { ProductFinderRedactor } from './product-finder/ProductFinderRedactor';
import { PricingProductFinderReader } from './product-finder/PricingProductFinderReader';
import { StartProductFinderUseCase } from '../application/use-cases/product-finder/StartProductFinderUseCase';
import { AnswerProductFinderStepUseCase } from '../application/use-cases/product-finder/AnswerProductFinderStepUseCase';
import { CompleteProductFinderUseCase } from '../application/use-cases/product-finder/CompleteProductFinderUseCase';
import { GetProductFinderRecommendationsUseCase } from '../application/use-cases/product-finder/GetProductFinderRecommendationsUseCase';
import { RecordProductFinderActionUseCase } from '../application/use-cases/product-finder/RecordProductFinderActionUseCase';

import { DrizzleMeasurementControlTowerRepository } from './admin/DrizzleMeasurementControlTowerRepository';
import { DrizzleMeasurementControlTowerAuditRepository } from './admin/DrizzleMeasurementControlTowerAuditRepository';
import { DefaultMeasurementControlTowerAccessPolicy } from './admin/DefaultMeasurementControlTowerAccessPolicy';
import { MeasurementControlTowerRedactor } from './admin/MeasurementControlTowerRedactor';
import { MeasurementControlTowerMapper } from './admin/MeasurementControlTowerMapper';

import { GetMeasurementControlTowerSummaryUseCase } from '../application/use-cases/admin/GetMeasurementControlTowerSummaryUseCase';
import { GetMeasurementControlTowerSectionUseCase } from '../application/use-cases/admin/GetMeasurementControlTowerSectionUseCase';
import { ListMeasurementControlTowerWarningsUseCase } from '../application/use-cases/admin/ListMeasurementControlTowerWarningsUseCase';
import { ListRecentMeasurementEventsUseCase } from '../application/use-cases/admin/ListRecentMeasurementEventsUseCase';
import { RecordMeasurementControlTowerViewUseCase } from '../application/use-cases/admin/RecordMeasurementControlTowerViewUseCase';

import { DrizzleReleaseReadinessRepository } from './release/DrizzleReleaseReadinessRepository';
import { DrizzleReleaseReadinessAuditRepository } from './release/DrizzleReleaseReadinessAuditRepository';
import { DefaultReleaseReadinessAccessPolicy } from './release/DefaultReleaseReadinessAccessPolicy';
import { DefaultReleaseEvidenceRedactor } from './release/DefaultReleaseEvidenceRedactor';
import { SafeReleaseReadinessCheckRunner } from './release/SafeReleaseReadinessCheckRunner';
import { GetReleaseReadinessSummaryUseCase } from '../application/use-cases/release/GetReleaseReadinessSummaryUseCase';
import { RunReleaseReadinessChecksUseCase } from '../application/use-cases/release/RunReleaseReadinessChecksUseCase';
import { GetReleaseReadinessRunUseCase } from '../application/use-cases/release/GetReleaseReadinessRunUseCase';
import { ListReleaseReadinessRunsUseCase } from '../application/use-cases/release/ListReleaseReadinessRunsUseCase';
import { RecordReleaseDecisionUseCase } from '../application/use-cases/release/RecordReleaseDecisionUseCase';
import { AcknowledgeReleaseGateUseCase } from '../application/use-cases/release/AcknowledgeReleaseGateUseCase';

import { DrizzleControlledActivationRepository } from './activation/DrizzleControlledActivationRepository';
import { DrizzleControlledActivationAuditRepository } from './activation/DrizzleControlledActivationAuditRepository';
import { DefaultControlledActivationAccessPolicy } from './activation/DefaultControlledActivationAccessPolicy';
import { SafeControlledActivationReadinessChecker } from './activation/SafeControlledActivationReadinessChecker.js';
import { ControlledActivationMapper } from './activation/ControlledActivationMapper.js';
import { DrizzleActivationStakeholderApprovalRepository } from './activation/DrizzleActivationStakeholderApprovalRepository.js';
import { DefaultActivationEvidenceRedactor } from './activation/DefaultActivationEvidenceRedactor.js';
import { CreateControlledActivationRequestUseCase } from '../application/use-cases/activation/CreateControlledActivationRequestUseCase';
import { GetControlledActivationRequestUseCase } from '../application/use-cases/activation/GetControlledActivationRequestUseCase';
import { GetControlledActivationSummaryUseCase } from '../application/use-cases/activation/GetControlledActivationSummaryUseCase';
import { ListControlledActivationRequestsUseCase } from '../application/use-cases/activation/ListControlledActivationRequestsUseCase';
import { RunControlledActivationReadinessChecksUseCase } from '../application/use-cases/activation/RunControlledActivationReadinessChecksUseCase';
import { RecordControlledActivationApprovalUseCase } from '../application/use-cases/activation/RecordControlledActivationApprovalUseCase';
import { RejectControlledActivationRequestUseCase } from '../application/use-cases/activation/RejectControlledActivationRequestUseCase';
import { CancelControlledActivationRequestUseCase } from '../application/use-cases/activation/CancelControlledActivationRequestUseCase';
import { AcknowledgeActivationBlockerUseCase } from '../application/use-cases/activation/AcknowledgeActivationBlockerUseCase';

import { DrizzleControlledActivationExecutionPlanRepository } from './activation/DrizzleControlledActivationExecutionPlanRepository';
import { DrizzleControlledActivationDryRunRepository } from './activation/DrizzleControlledActivationDryRunRepository';
import { DefaultControlledActivationPayloadPreviewer } from './activation/DefaultControlledActivationPayloadPreviewer';
import { DefaultControlledActivationEvidencePackBuilder } from './activation/DefaultControlledActivationEvidencePackBuilder';
import { DefaultControlledActivationCanaryPlanner } from './activation/DefaultControlledActivationCanaryPlanner';
import { CreateControlledActivationExecutionPlanUseCase } from '../application/use-cases/activation/CreateControlledActivationExecutionPlanUseCase';
import { RunControlledActivationDryRunUseCase } from '../application/use-cases/activation/RunControlledActivationDryRunUseCase';
import { CancelControlledActivationDryRunUseCase } from '../application/use-cases/activation/CancelControlledActivationDryRunUseCase';
import { GenerateDestinationPayloadPreviewsUseCase } from '../application/use-cases/activation/GenerateDestinationPayloadPreviewsUseCase';
import { BuildControlledActivationEvidencePackUseCase } from '../application/use-cases/activation/BuildControlledActivationEvidencePackUseCase';
import { ValidateControlledActivationCanaryPlanUseCase } from '../application/use-cases/activation/ValidateControlledActivationCanaryPlanUseCase';

import { DrizzleControlledActivationLiveReviewRepository } from './activation/DrizzleControlledActivationLiveReviewRepository';
import { DrizzleControlledActivationOperatorChecklistRepository } from './activation/DrizzleControlledActivationOperatorChecklistRepository';
import { DrizzleControlledActivationStakeholderLiveApprovalRepository } from './activation/DrizzleControlledActivationStakeholderLiveApprovalRepository';
import { DrizzleControlledActivationIncidentPlanRepository } from './activation/DrizzleControlledActivationIncidentPlanRepository';
import { DefaultControlledActivationLiveReadinessChecker } from './activation/DefaultControlledActivationLiveReadinessChecker';
import { DefaultControlledActivationRunbookBuilder } from './activation/DefaultControlledActivationRunbookBuilder';
import { CreateControlledActivationLiveReviewCandidateUseCase } from '../application/use-cases/activation/CreateControlledActivationLiveReviewCandidateUseCase';
import { RunControlledActivationLiveReadinessChecksUseCase } from '../application/use-cases/activation/RunControlledActivationLiveReadinessChecksUseCase';
import { BuildControlledActivationRunbookUseCase } from '../application/use-cases/activation/BuildControlledActivationRunbookUseCase';
import { RecordControlledActivationStakeholderLiveApprovalUseCase } from '../application/use-cases/activation/RecordControlledActivationStakeholderLiveApprovalUseCase';
import { RecordControlledActivationOperatorAcknowledgementUseCase } from '../application/use-cases/activation/RecordControlledActivationOperatorAcknowledgementUseCase';
import { CancelControlledActivationLiveReviewCandidateUseCase } from '../application/use-cases/activation/CancelControlledActivationLiveReviewCandidateUseCase';
import { ExpireControlledActivationLiveReviewCandidateUseCase } from '../application/use-cases/activation/ExpireControlledActivationLiveReviewCandidateUseCase';
import { GetControlledActivationLiveReviewCandidateUseCase } from '../application/use-cases/activation/GetControlledActivationLiveReviewCandidateUseCase';
import { ListControlledActivationLiveReviewCandidatesUseCase } from '../application/use-cases/activation/ListControlledActivationLiveReviewCandidatesUseCase';

import { DrizzleControlledLiveCanaryRepository } from './activation/DrizzleControlledLiveCanaryRepository';
import { DrizzleControlledLiveCanaryAuditRepository } from './activation/DrizzleControlledLiveCanaryAuditRepository';
import { DefaultControlledLiveCanaryTransport } from './activation/DefaultControlledLiveCanaryTransport';
import { DefaultControlledLiveCanaryKillSwitch } from './activation/DefaultControlledLiveCanaryKillSwitch';
import { DefaultControlledLiveCanaryEvidenceBuilder } from './activation/DefaultControlledLiveCanaryEvidenceBuilder';

import { CreateControlledLiveCanaryUseCase } from '../application/use-cases/activation/CreateControlledLiveCanaryUseCase';
import { EvaluateControlledLiveCanaryEligibilityUseCase } from '../application/use-cases/activation/EvaluateControlledLiveCanaryEligibilityUseCase';
import { StartControlledLiveCanaryUseCase } from '../application/use-cases/activation/StartControlledLiveCanaryUseCase';
import { PauseControlledLiveCanaryUseCase } from '../application/use-cases/activation/PauseControlledLiveCanaryUseCase';
import { RollbackControlledLiveCanaryUseCase } from '../application/use-cases/activation/RollbackControlledLiveCanaryUseCase';
import { CompleteControlledLiveCanaryUseCase } from '../application/use-cases/activation/CompleteControlledLiveCanaryUseCase';
import { BuildControlledLiveCanaryEvidencePackUseCase } from '../application/use-cases/activation/BuildControlledLiveCanaryEvidencePackUseCase';
import { GetControlledLiveCanaryUseCase } from '../application/use-cases/activation/GetControlledLiveCanaryUseCase';
import { ListControlledLiveCanariesUseCase } from '../application/use-cases/activation/ListControlledLiveCanariesUseCase';
import { DrizzleFulfilmentRepository } from './db/repositories/DrizzleFulfilmentRepository';
import { CreateFulfilmentTaskOnOrderPlacedUseCase } from '../application/use-cases/fulfilment/CreateFulfilmentTaskOnOrderPlacedUseCase';
import { MarkFulfilmentPaymentConfirmedUseCase } from '../application/use-cases/fulfilment/MarkFulfilmentPaymentConfirmedUseCase';
import { TransitionFulfilmentTaskUseCase } from '../application/use-cases/fulfilment/TransitionFulfilmentTaskUseCase';
import { ListFulfilmentQueueUseCase } from '../application/use-cases/fulfilment/ListFulfilmentQueueUseCase';
import { GetFulfilmentOverviewUseCase } from '../application/use-cases/fulfilment/GetFulfilmentOverviewUseCase';
import { AssignFulfilmentTaskUseCase } from '../application/use-cases/fulfilment/AssignFulfilmentTaskUseCase';
import { SetFulfilmentPriorityUseCase } from '../application/use-cases/fulfilment/SetFulfilmentPriorityUseCase';
import { DrizzleFulfilmentTeamRepository } from './db/repositories/DrizzleFulfilmentTeamRepository';
import {
  CreateFulfilmentTeamUseCase,
  ListFulfilmentTeamsUseCase,
  ManageTeamMemberUseCase,
  MoveFulfilmentTeamUseCase,
  BulkAssignFulfilmentTasksUseCase,
} from '../application/use-cases/fulfilment/FulfilmentTeamUseCases';
import { DrizzleFulfilmentSlaEventRepository } from './db/repositories/DrizzleFulfilmentSlaEventRepository';
import { EvaluateFulfilmentSlaBatchUseCase } from '../application/use-cases/fulfilment/EvaluateFulfilmentSlaBatchUseCase';
import { DrizzleFulfilmentLineRepository, DrizzlePackingSessionRepository } from './db/repositories/DrizzleFulfilmentLineRepository';
import { DrizzleFulfilmentLineSourceReader } from './db/repositories/DrizzleFulfilmentLineSourceReader';
import {
  InitialiseFulfilmentLinesUseCase,
  GetPackingDetailUseCase,
  StartPackingUseCase,
  UpdatePackedQuantitiesUseCase,
  ResolveRemainderUseCase,
  CompletePackingUseCase,
  RecordPackingExceptionUseCase,
} from '../application/use-cases/fulfilment/PackingUseCases';
import { logger } from './logging/logger';
import { RedisLoginAttemptStore } from './security/RedisLoginAttemptStore';
import { DrizzleSessionRepository } from './db/repositories/DrizzleSessionRepository';
import { SessionService } from './security/SessionService';
import { DrizzleMfaRepository } from './db/repositories/DrizzleMfaRepository';
import { MfaService } from './security/MfaService';
import { DrizzleCommerceReconciliationRepository } from './db/repositories/DrizzleCommerceReconciliationRepository';
import { ScanCommerceIntegrityUseCase } from '../application/use-cases/commerce/ScanCommerceIntegrityUseCase';
import { OrderTransitionService } from './orders/OrderTransitionService';
import { DrizzleProductQualityRepository } from './db/repositories/DrizzleProductQualityRepository';
import { ScoreProductQualityUseCase } from '../application/use-cases/products/ScoreProductQualityUseCase';
import { DrizzleCustomerRfmRepository } from './db/repositories/DrizzleCustomerRfmRepository';
import { ScoreCustomerRfmUseCase } from '../application/use-cases/customer-dna/ScoreCustomerRfmUseCase';
import { DrizzleExplorerQueryRepository } from './db/repositories/DrizzleExplorerQueryRepository';
import { RunExplorerQueryUseCase } from '../application/use-cases/analytics/RunExplorerQueryUseCase';
import { DrizzleInventoryRepository } from './db/repositories/DrizzleInventoryRepository';
import { DrizzleOrderReservationState } from './db/repositories/DrizzleOrderReservationState';
import { DrizzleCheckoutIdempotencyRepository } from './db/repositories/DrizzleCheckoutIdempotencyRepository';
import { DrizzleCheckoutSideEffectRecorder } from './db/repositories/DrizzleCheckoutSideEffectRecorder';
import {
  DrizzleAuthorizedCartRepository,
  DrizzleCartProductReader,
} from './db/repositories/DrizzleAuthorizedCartRepository';
import { MutateCartUseCase } from '../application/use-cases/commerce/MutateCartUseCase';
import { ExecuteCheckoutIntentUseCase } from '../application/use-cases/commerce/ExecuteCheckoutIntentUseCase';
import { StartOrderPaymentUseCase } from '../application/use-cases/commerce/StartOrderPaymentUseCase';
import { ReconcileOrderPaymentUseCase } from '../application/use-cases/commerce/ReconcileOrderPaymentUseCase';
import { ProcessCheckoutSideEffectBatchUseCase } from '../application/use-cases/outbox/ProcessCheckoutSideEffectBatchUseCase';
import { SetProductStockUseCase } from '../application/use-cases/inventory/SetProductStockUseCase';
import {
  ReserveInventoryForOrderUseCase,
  ReleaseInventoryForOrderUseCase,
  ConsumeInventoryForOrderUseCase,
  GetInventoryAvailabilityUseCase,
  ListLowStockUseCase,
} from '../application/use-cases/inventory/InventoryUseCases';
import { DrizzleFulfilmentDispatchRepository } from './db/repositories/DrizzleFulfilmentDispatchRepository';
import {
  GetDispatchUseCase,
  RecordDispatchUseCase,
  UpdateDispatchTrackingUseCase,
} from '../application/use-cases/fulfilment/DispatchUseCases';
import { DrizzleFulfilmentDeliveryRepository } from './db/repositories/DrizzleFulfilmentDeliveryRepository';
import { DrizzleFulfilmentReportRepository } from './db/repositories/DrizzleFulfilmentReportRepository';
import {
  GetDeliveryHistoryUseCase,
  RecordDeliveryUseCase,
  GetFulfilmentReportUseCase,
} from '../application/use-cases/fulfilment/DeliveryUseCases';
import {
  DrizzleCustomerProfileRepository,
  DrizzleCustomerIdentityRepository,
  DrizzleCustomerFeatureRepository,
  DrizzleCustomerLifecycleRepository,
  DrizzleNbaDecisionRepository,
} from './db/repositories/DrizzleCustomerDnaRepositories';
import { DrizzleCustomerSignalReader } from './db/repositories/DrizzleCustomerSignalReader';
import {
  ResolveCustomerIdentityUseCase,
  ProjectCustomerProfileUseCase,
  GenerateNextBestActionUseCase,
  GetCustomerDnaUseCase,
} from '../application/use-cases/customer-dna/CustomerDnaUseCases';
import { DrizzleDecisionEvidenceReader } from './db/repositories/DrizzleDecisionEvidenceReader';
import { DrizzleDecisionInsightRepository } from './db/repositories/DrizzleDecisionInsightRepository';
import { DrizzleAnalyticsReadRepository } from './db/repositories/DrizzleAnalyticsReadRepository';
import {
  DrizzleAnalyticsAlertRuleRepository,
  DrizzleAnalyticsSavedViewRepository,
} from './db/repositories/DrizzleAnalyticsConfigRepositories';
import {
  GetAnalyticsBreakdownUseCase,
  GetAnalyticsExceptionDrilldownUseCase,
  GetPaymentIntelligenceUseCase,
} from '../application/use-cases/analytics/PaymentIntelligenceUseCases';
import {
  EvaluateAnalyticsAlertRulesUseCase,
  ExportAnalyticsUseCase,
  ManageAnalyticsAlertRulesUseCase,
  ManageAnalyticsSavedViewsUseCase,
} from '../application/use-cases/analytics/AnalyticsConfigUseCases';
import {
  GetAnalyticsDataQualityUseCase,
  GetAnalyticsMetricSeriesUseCase,
  GetAnalyticsOverviewUseCase,
} from '../application/use-cases/analytics/CommerceAnalyticsUseCases';
import {
  EvaluateDecisionSignalsBatchUseCase,
  GetDecisionInsightUseCase,
  ListDecisionInsightsUseCase,
  GetDecisionOverviewUseCase,
  TransitionDecisionInsightUseCase,
  RecomputeDecisionInsightUseCase,
} from '../application/use-cases/decision-intelligence/DecisionIntelligenceUseCases';
import { DrizzleAutomationRepository, DrizzleAutomationExecutionRepository, DrizzleAutomationAudienceReader } from './db/repositories/DrizzleAutomationRepositories';
import { DrizzleAutomationEligibilityRepository } from './db/repositories/DrizzleAutomationEligibilityRepository';
import { DrizzleAutomationActionRepository } from './db/repositories/DrizzleAutomationActionRepository';
import { PlanAutomationExecutionUseCase } from '../application/use-cases/automation/PlanAutomationExecutionUseCase';
import { EvaluateExecutionEligibilityUseCase } from '../application/use-cases/automation/EvaluateExecutionEligibilityUseCase';
import { ExecuteAutomationActionUseCase } from '../application/use-cases/automation/ExecuteAutomationActionUseCase';
import { ReplayAutomationActionUseCase } from '../application/use-cases/automation/ReplayAutomationActionUseCase';
import { ReconcileAutomationOutcomeUseCase } from '../application/use-cases/automation/ReconcileAutomationOutcomeUseCase';
import { AutomationInternalActionExecutor } from './automation/AutomationInternalActionExecutor';
import { DrizzleAutomationOperationsRepository } from './db/repositories/DrizzleAutomationOperationsRepository';
import { AutomationOperationsUseCase } from '../application/use-cases/automation/AutomationOperationsUseCase';

export class Registry {

  private static _instance: Registry;
  
  // Repositories
  public readonly cartRepo = new DrizzleCartRepository();
  public readonly cartQueryRepo = new DrizzleCartQueryRepository();
  public readonly orderRepo = new DrizzleOrderRepository();
  public readonly productRepo = new DrizzleProductRepository();
  public readonly deviceRepo = new DrizzleDeviceRepository();
  public readonly pricingRepo = new DrizzlePricingRepository();
  public readonly pricingQuoteRepo = new DrizzlePricingQuoteRepository();
  public readonly pricingCapacityRepo = new DrizzlePricingCapacityRepository();
  public readonly couponRepo = new DrizzleCouponRepository();
  public readonly reviewRepo = new DrizzleReviewRepository();
  public readonly creatorRepo = new DrizzleCreatorRepository();
  public readonly flashSaleRepo = new DrizzleFlashSaleRepository();
  public readonly seoRepo = new DrizzleSeoRepository();
  public readonly mobileMoneyDisbursement = new NoSendMobileMoneyDisbursement();
  public readonly submitReviewUseCase = new SubmitReviewUseCase(this.reviewRepo, process.env.IDENTITY_HASH_PEPPER ?? '');
  public readonly pricingOperationsRepo = new DrizzlePricingOperationsRepository();
  public readonly dealerRepo = new DrizzleDealerRepository();
  public readonly supportRepo = new DrizzleSupportRepository();
  public readonly quoteRepo = new DrizzleQuoteRepository();
  public readonly verificationRepo = new DrizzleVerificationRepository();
  public readonly auditRepo = new DrizzleAuditRepository();
  public readonly createAuditLogUseCase = new CreateAuditLogUseCase(this.auditRepo);
  public readonly paymentRepo = new DrizzlePaymentRepository();
  public readonly userRepo = new DrizzleUserRepository();
  public readonly addressRepo = new DrizzleAddressRepository();
  public readonly addressAuditRepo = new DrizzleAddressAuditRepository();
  public readonly roleRepo = new DrizzleRoleRepository();
  public readonly fakeReportRepo = new DrizzleFakeReportRepository();
  public readonly adminRoleReadRepo = new DrizzleAdminRoleReadRepository();
  public readonly recommendationEventRepo = new DrizzleRecommendationEventRepository();
  public readonly recommendationRuleRepo = new DrizzleRecommendationRuleRepository();
  public readonly recommendationRuleAuditRepo = new DrizzleRecommendationRuleAuditRepository();
  public readonly productRecommendationReader = new DrizzleProductRecommendationReader();
  public readonly recommendationAnalyticsRepo = new DrizzleRecommendationAnalyticsRepository();
  public readonly pesapalPaymentRepo = new DrizzlePaymentAttemptRepository();
  public readonly pesapalClient: IPesaPalClient = new PesaPalClient(env);
  public readonly systemHealthRepo = new DrizzleSystemHealthRepository();

  // Storage. In production MEDIA_STORAGE_ROOT points at the shared media volume the
  // edge serves (/uploads/* -> volume); the dev fallback keeps writing into
  // web/public so local Astro serves the same URLs.
  private readonly productImageStorage = new LocalProductImageStorage(
    process.env.MEDIA_STORAGE_ROOT ||
      path.join(process.cwd().endsWith('apps/api') ? process.cwd() : path.join(process.cwd(), 'apps', 'api'), '..', 'web', 'public')
  );

  // Wave 2C — legal policy CMS.
  public readonly legalCmsRepo = new DrizzleLegalCmsRepository();
  public readonly legalCmsUseCase = new LegalCmsUseCase(this.legalCmsRepo);

  // Wave 2F — campaign scaffold (no-send): first owner of campaigns/utm_links.
  public readonly campaignRepo = new DrizzleCampaignRepository();
  public readonly campaignSendRepo = new DrizzleCampaignSendRepository();
  public readonly gamificationRepo = new DrizzleGamificationRepository();
  public readonly adminUserWriteRepo = new DrizzleAdminUserWriteRepository();
  // Stateless hasher constructed inline: the shared field is declared later in the
  // class and TS rightly refuses use-before-initialization.
  public readonly adminUserManagementUseCase = new AdminUserManagementUseCase(this.adminUserWriteRepo, new ScryptPasswordHasher());
  public readonly campaignSendEngine = new CampaignSendEngineUseCase(this.campaignSendRepo, this.campaignSendRepo);

  // Wave 2E-3 — notification wording overrides.
  public readonly notificationTemplateRepo = new DrizzleNotificationTemplateRepository();

  // Wave 2E-2 — governed manual stock adjustments.
  public readonly adjustStockUseCase = new AdjustStockUseCase(new DrizzleStockAdjustmentRepository());

  // Wave 2E-1 — abandonment pipeline: hourly evaluator + queue announcement.
  public readonly abandonmentRepo = new DrizzleAbandonmentRepository();
  public readonly abandonmentUseCase = new AbandonmentUseCase(this.abandonmentRepo, {
    publish: async (record) => {
      const queue = QueueService.getInstance().getQueue(QUEUES.ABANDONED_CART_EVENTS);
      if (!queue) return; // queue backend absent (dev without Redis): classification still recorded
      await queue.add('abandonment-classified', {
        recordId: record.id,
        cartId: record.cartId,
        itemCount: record.itemCount,
        subtotalUgx: record.subtotalUgx,
        classifiedAt: record.classifiedAt.toISOString(),
      });
    },
  });

  // Wave 2B — media library (DAM) on the same storage owner.
  public readonly mediaLibraryRepo = new DrizzleMediaLibraryRepository();
  public readonly mediaLibraryUseCase = new MediaLibraryUseCase(
    this.mediaLibraryRepo,
    this.productImageStorage,
    new SharpVariantGenerator(),
  );

  public readonly adminUserReadRepo = new DrizzleAdminUserReadRepository();
  public readonly productImageRepo = new DrizzleProductImageRepository();
  public readonly attributeRepo = new DrizzleAttributeRepository();
  public readonly notificationAttemptRepo = new DrizzleNotificationAttemptRepository();
  public readonly outboxRepo = new DrizzleOutboxRepository();
  public readonly automationActionRepo = new DrizzleAutomationActionRepository();
  public readonly automationOperationsRepo = new DrizzleAutomationOperationsRepository();
  public readonly experimentRepo = new DrizzleExperimentRepository();
  public readonly fraudTriageRepo = new DrizzleFraudTriageRepository();
  public readonly pimImportRepo = new DrizzlePimImportRepository();
  public readonly surveyRepo = new DrizzleSurveyRepository();
  public readonly copyQualityCatalog = new DrizzleCopyQualityCatalogReader();
  public readonly behaviouralInterventionRepo = new DrizzleBehaviouralInterventionRepository();

  public readonly measurementAdminRepo = new DrizzleMeasurementAdminRepository();
  public readonly dlqRepo = new DrizzleDlqRepository();
  public readonly attributionRepo = new DrizzleAttributionRepository();
  public readonly consentReadRepo = new DrizzleConsentReadRepository();
  public readonly consentRepo = new DrizzleConsentRepository();
  public readonly zpdRepo = new DrizzleZeroPartyDataRepository();
  public readonly measurementLogger = new PinoMeasurementLogger();

  public readonly gtmRepo = new GoogleTagManagerRepository();
  public readonly gtmPlanRepo = new DrizzleGtmPlanRepository();
  public readonly gtmPlanBuilder = new GtmPlanBuilder();
  public readonly gtmDiffService = new GtmDiffService();
  public readonly paidSocialDestinationRepo = new DrizzlePaidSocialDestinationRepository();
  public readonly paidSocialDeliveryRepo = new DrizzlePaidSocialDeliveryRepository();
  public readonly paidSocialCredentialRepo = new EnvPaidSocialCredentialStatusRepository();
  public readonly measurementQueuePort = new BullMQMeasurementQueueAdapter();
  public readonly hashingService = new Sha256MeasurementHashingService();
  public readonly payloadMapper = new PaidSocialPayloadMapper(this.hashingService);
  public readonly payloadRedactor = new PaidSocialPayloadRedactor();
  
  public readonly paymentMeasurementRepo = new DrizzlePaymentMeasurementRepository();
  public readonly paymentAttributionRepo = new DrizzlePaymentAttributionRepository();
  // using the same BullMQ adapter for now, or just setting queue to null for fallback
  public readonly purchaseMeasurementQueue = new BullMqPurchaseMeasurementQueue(null, this.measurementLogger);
  public readonly genericMeasurementQueue = new BullMqGenericMeasurementQueue(null, this.measurementLogger);
  public readonly paymentMeasurementRedactor = new PaymentMeasurementRedactor();
  public readonly pesapalMeasurementMapper = new PesapalMeasurementMapper(this.paymentMeasurementRedactor);

  // Infrastructure Adapters
  public readonly whatsappAdapter = new WhatsAppAdapter();
  public readonly zeptoMailAdapter = new ZeptoMailAdapter();
  public readonly smsAdapter = process.env.SMS_PROVIDER === 'pahappa_comms'
    ? new PahappaCommsSmsAdapter()
    : new DisabledSmsAdapter();

  // Services & Routers
  public readonly notificationRouter = new DefaultNotificationRouter(
    this.zeptoMailAdapter,
    this.whatsappAdapter,
    this.smsAdapter,
    this.automationActionRepo
  );

  // Recommendation Logic
  private readonly recommendationSignalExtractor = new ProductSignalExtractor();
  private readonly recommendationCompatibility = new CompatibilityRuleService();
  private readonly recommendationScoring = new RecommendationScoringService(this.recommendationCompatibility);
  private readonly recommendationTrending = new TrendingScoreService(this.recommendationEventRepo);
  private readonly recommendationFallback = new RecommendationFallbackService(this.productRecommendationReader);
  private readonly recommendationEligibility = new RecommendationEligibilityService();
  public readonly recommendationDedupe = new RecommendationDeduplicationService();
  public readonly recommendationDiversity = new RecommendationDiversityService();
  public readonly recommendationAnalyticsService = new RecommendationAnalyticsService(this.recommendationAnalyticsRepo);


  // Security Services
  public readonly passwordHasher = new ScryptPasswordHasher();
  public readonly tokenSigner = new Hs256TokenSigner();

  // Use Cases
  public readonly addToCartUseCase = new AddToCartUseCase(this.cartRepo);
  public readonly getCartByIdUseCase = new GetCartByIdUseCase(this.cartQueryRepo);
  public readonly deliveryZoneRepo = new DrizzleDeliveryZoneRepository();
  public readonly getPaymentReconciliationUseCase = new GetPaymentReconciliationUseCase(this.orderRepo, this.paymentRepo, this.pesapalPaymentRepo);
  public readonly searchDemandRepo = new DrizzleSearchDemandRepository();
  public readonly suggestProductsUseCase = new SuggestProductsUseCase(this.productRepo);
  public readonly recordSearchEventUseCase = new RecordSearchEventUseCase(this.searchDemandRepo);
  public readonly recordSearchInteractionUseCase = new RecordSearchInteractionUseCase(this.searchDemandRepo);
  public readonly listSearchDemandUseCase = new ListSearchDemandUseCase(this.searchDemandRepo);
  public readonly getSearchInsightsUseCase = new GetSearchInsightsUseCase(this.searchDemandRepo);
  public readonly updateSearchDemandStatusUseCase = new UpdateSearchDemandStatusUseCase(this.searchDemandRepo);
  public readonly compatibilityMappingRepo = new DrizzleCompatibilityMappingRepository();
  public readonly upsertCompatibilityMappingUseCase = new UpsertCompatibilityMappingUseCase(this.compatibilityMappingRepo, this.productRepo);
  public readonly listCompatibilityMappingsUseCase = new ListCompatibilityMappingsUseCase(this.compatibilityMappingRepo);
  public readonly deleteCompatibilityMappingUseCase = new DeleteCompatibilityMappingUseCase(this.compatibilityMappingRepo);
  public readonly getProductCompatibilityUseCase = new GetProductCompatibilityUseCase(this.compatibilityMappingRepo, this.productRepo);
  public readonly loyaltyRepo = new DrizzleLoyaltyRepository();
  public readonly loyaltyGate = new LoyaltyProgrammeGate(this.loyaltyRepo, () => process.env.LOYALTY_PROGRAMME_ENABLED === 'true');
  public readonly earnLoyaltyPointsUseCase = new EarnLoyaltyPointsUseCase(this.loyaltyRepo, this.loyaltyGate);
  public readonly redeemLoyaltyPointsUseCase = new RedeemLoyaltyPointsUseCase(this.loyaltyRepo, this.loyaltyGate);
  public readonly expireLoyaltyPointsUseCase = new ExpireLoyaltyPointsUseCase(this.loyaltyRepo);
  public readonly reverseLoyaltyEntryUseCase = new ReverseLoyaltyEntryUseCase(this.loyaltyRepo);
  public readonly getLoyaltyHistoryUseCase = new GetLoyaltyHistoryUseCase(this.loyaltyRepo, this.loyaltyGate);
  public readonly getLoyaltyOperationsUseCase = new GetLoyaltyOperationsUseCase(this.loyaltyRepo);
  public readonly getLoyaltyConfigUseCase = new GetLoyaltyConfigUseCase(this.loyaltyRepo);
  public readonly saveLoyaltyConfigUseCase = new SaveLoyaltyConfigUseCase(this.loyaltyRepo);
  public readonly getSupportInboxUseCase = new GetSupportInboxUseCase(this.supportRepo);
  public readonly updateSupportTicketUseCase = new UpdateSupportTicketUseCase(this.supportRepo);
  public readonly lifecycleReadRepo = new DrizzleLifecycleReadRepository();
  public readonly getLifecycleSegmentsUseCase = new GetLifecycleSegmentsUseCase(this.lifecycleReadRepo);
  public readonly loginAttemptStore = new RedisLoginAttemptStore();
  // Slice 3B: durable, revocable sessions (PostgreSQL source of truth).
  public readonly sessionRepository = new DrizzleSessionRepository();
  public readonly sessionService = new SessionService(this.sessionRepository);
  // Slice 3C: privileged MFA + step-up.
  public readonly mfaRepository = new DrizzleMfaRepository();
  public readonly mfaService = new MfaService(this.mfaRepository);
  // Slice 4: commerce data-integrity reconciliation (money + inventory).
  public readonly commerceReconciliationRepository = new DrizzleCommerceReconciliationRepository();
  public readonly scanCommerceIntegrityUseCase = new ScanCommerceIntegrityUseCase(this.commerceReconciliationRepository);
  // P0-2: canonical transactional order-status transition + append-only ledger.
  public readonly orderTransitionService = new OrderTransitionService();
  // Slice 5: product data-quality scoring.
  public readonly productQualityRepository = new DrizzleProductQualityRepository();
  public readonly scoreProductQualityUseCase = new ScoreProductQualityUseCase(this.productQualityRepository);
  // Slice 6: customer RFM scoring + segmentation.
  public readonly customerRfmRepository = new DrizzleCustomerRfmRepository();
  public readonly scoreCustomerRfmUseCase = new ScoreCustomerRfmUseCase(this.customerRfmRepository);
  // Slice 7: self-service explorer (catalogue-approved query compiler).
  public readonly explorerQueryRepository = new DrizzleExplorerQueryRepository();
  public readonly runExplorerQueryUseCase = new RunExplorerQueryUseCase(this.explorerQueryRepository);
  public readonly evaluateCartPricingUseCase = new EvaluateCartPricingUseCase(
    this.productRepo,
    this.pricingRepo,
    this.pricingQuoteRepo,
  );
  public readonly managePromotionCapacityUseCase = new ManagePromotionCapacityUseCase(this.pricingCapacityRepo);
  public readonly redeemCouponUseCase = new RedeemCouponUseCase(this.couponRepo);
  public readonly firstOrderEligibilityUseCase = new FirstOrderEligibilityUseCase(this.couponRepo, process.env.IDENTITY_HASH_PEPPER ?? '');
  public readonly pricingGovernanceUseCase = new PricingGovernanceUseCase(this.pricingRepo, this.createAuditLogUseCase, {
    // AC10 — configurable (not hidden constants); each activation audits which threshold applied.
    percentBpsThreshold: Number(process.env.PROMOTION_APPROVAL_PERCENT_BPS_THRESHOLD ?? 2000),
    fixedUgxThreshold: Number(process.env.PROMOTION_APPROVAL_FIXED_UGX_THRESHOLD ?? 100_000),
  });
  public readonly pricingOperationsUseCase = new PricingOperationsUseCase(
    this.pricingGovernanceUseCase,
    this.evaluateCartPricingUseCase,
    this.pricingOperationsRepo,
    this.createAuditLogUseCase,
  );
  public readonly checkoutUseCase = new CheckoutUseCase(
    this.orderRepo,
    this.productRepo,
    this.deliveryZoneRepo,
    {
      evaluator: this.evaluateCartPricingUseCase,
      capacity: this.managePromotionCapacityUseCase,
      quotes: this.pricingQuoteRepo,
      orders: this.orderRepo,
    },
    new CodPolicyReader(),
    new CheckoutVelocitySignal(),
    // Lazy closures: the loyalty completion services are constructed later in
    // this class body; resolving through the singleton avoids field-order
    // coupling while keeping the use case pure against its port shape.
    {
      reserve: (input) => Registry.getInstance().reserveRedemptionUseCase.execute(input),
      attach: (reservationId, orderId) => Registry.getInstance().loyaltyCompletionRepo.attachReservationToOrder(reservationId, orderId),
      release: (input) => Registry.getInstance().releaseRedemptionUseCase.execute({ reservationId: input.reservationId }),
    },
  );
  // Launch Phase 1 (Section 9.3): order-to-admin fulfilment alerts.
  public readonly fulfilmentRepo = new DrizzleFulfilmentRepository();
  public readonly createFulfilmentTaskOnOrderPlacedUseCase = new CreateFulfilmentTaskOnOrderPlacedUseCase(this.fulfilmentRepo);
  public readonly markFulfilmentPaymentConfirmedUseCase = new MarkFulfilmentPaymentConfirmedUseCase(this.fulfilmentRepo);
  public readonly transitionFulfilmentTaskUseCase = new TransitionFulfilmentTaskUseCase(this.fulfilmentRepo, this.auditRepo, this.orderTransitionService);
  public readonly listFulfilmentQueueUseCase = new ListFulfilmentQueueUseCase(this.fulfilmentRepo);
  public readonly fulfilmentSlaEventRepo = new DrizzleFulfilmentSlaEventRepository();
  public readonly getFulfilmentOverviewUseCase = new GetFulfilmentOverviewUseCase(this.fulfilmentRepo, this.fulfilmentSlaEventRepo);
  public readonly fulfilmentTeamRepo = new DrizzleFulfilmentTeamRepository();
  public readonly assignFulfilmentTaskUseCase = new AssignFulfilmentTaskUseCase(this.fulfilmentRepo, this.auditRepo, this.fulfilmentTeamRepo);
  public readonly setFulfilmentPriorityUseCase = new SetFulfilmentPriorityUseCase(this.fulfilmentRepo, this.auditRepo);
  // Fulfilment F1: team queues + ownership.
  public readonly createFulfilmentTeamUseCase = new CreateFulfilmentTeamUseCase(this.fulfilmentTeamRepo, this.auditRepo);
  public readonly listFulfilmentTeamsUseCase = new ListFulfilmentTeamsUseCase(this.fulfilmentTeamRepo);
  public readonly manageTeamMemberUseCase = new ManageTeamMemberUseCase(this.fulfilmentTeamRepo, this.auditRepo);
  public readonly moveFulfilmentTeamUseCase = new MoveFulfilmentTeamUseCase(this.fulfilmentRepo, this.fulfilmentTeamRepo, this.auditRepo);
  public readonly bulkAssignFulfilmentTasksUseCase = new BulkAssignFulfilmentTasksUseCase(this.fulfilmentRepo, this.fulfilmentTeamRepo, this.auditRepo);
  // Fulfilment F2: idempotent SLA escalation evaluator.
  public readonly evaluateFulfilmentSlaBatchUseCase = new EvaluateFulfilmentSlaBatchUseCase(this.fulfilmentRepo, this.fulfilmentSlaEventRepo, this.fulfilmentTeamRepo, this.auditRepo);
  // Fulfilment F3: packing, partial fulfilment and backorders.
  public readonly fulfilmentLineRepo = new DrizzleFulfilmentLineRepository();
  public readonly packingSessionRepo = new DrizzlePackingSessionRepository();
  public readonly fulfilmentLineSourceReader = new DrizzleFulfilmentLineSourceReader();
  public readonly initialiseFulfilmentLinesUseCase = new InitialiseFulfilmentLinesUseCase(this.fulfilmentRepo, this.fulfilmentLineRepo, this.fulfilmentLineSourceReader);
  public readonly getPackingDetailUseCase = new GetPackingDetailUseCase(this.fulfilmentRepo, this.fulfilmentLineRepo, this.packingSessionRepo);
  public readonly startPackingUseCase = new StartPackingUseCase(this.fulfilmentRepo, this.packingSessionRepo, this.auditRepo);
  public readonly updatePackedQuantitiesUseCase = new UpdatePackedQuantitiesUseCase(this.fulfilmentRepo, this.fulfilmentLineRepo, this.auditRepo);
  public readonly resolveRemainderUseCase = new ResolveRemainderUseCase(this.fulfilmentLineRepo, this.auditRepo);
  public readonly completePackingUseCase = new CompletePackingUseCase(this.fulfilmentRepo, this.fulfilmentLineRepo, this.packingSessionRepo, this.auditRepo);
  public readonly recordPackingExceptionUseCase = new RecordPackingExceptionUseCase(this.packingSessionRepo, this.auditRepo);
  // Inventory ledger (Section 12): reservation, release, consumption, availability.
  public readonly inventoryRepo = new DrizzleInventoryRepository();
  public readonly orderReservationState = new DrizzleOrderReservationState();
  public readonly checkoutIdempotencyRepo = new DrizzleCheckoutIdempotencyRepository();

  /**
   * Checkout orchestration, assembled from ports.
   *
   * The adapters below are deliberately thin: they exist so the use case never
   * imports Drizzle, Hono or a provider SDK, which is what keeps the workflow
   * testable without standing up HTTP.
   */
  public readonly checkoutSideEffectRecorder = new DrizzleCheckoutSideEffectRecorder();

  /**
   * Cart mutation, with ownership and optimistic concurrency.
   *
   * Replaces the inline logic the four cart routes each held separately — which is how
   * one of them came to have no authorization while another had none either, and why
   * concurrency policy lived in a transport adapter.
   */
  public readonly authorizedCartRepo = new DrizzleAuthorizedCartRepository();
  public readonly cartProductReader = new DrizzleCartProductReader();
  public readonly mutateCartUseCase = new MutateCartUseCase({
    carts: this.authorizedCartRepo,
    products: this.cartProductReader,
    observer: {
      // Cart ids and trace ids only. A denied cart operation is a security-relevant
      // event, and these lines outlive the request; no basket contents belong in them.
      onOwnershipDenied: (cartId, traceId) =>
        logger.warn({ cartId, traceId }, 'CART_OWNERSHIP_DENIED'),
      onVersionConflict: (cartId, traceId) =>
        logger.info({ cartId, traceId }, 'CART_VERSION_CONFLICT'),
    },
  });

  public readonly executeCheckoutIntentUseCase = new ExecuteCheckoutIntentUseCase({
    idempotency: this.checkoutIdempotencyRepo,
    sideEffectRecorder: this.checkoutSideEffectRecorder,
    // Derived through a labelled HMAC so the digest key is unrelated to the session,
    // checkout-intent and cart-credential key streams even from one root secret.
    fingerprintDigestKey: createHmac('sha256', 'goldplus-checkout-fingerprint-v1')
      .update((process.env.CHECKOUT_INTENT_SECRET || process.env.JWT_SECRET || '').trim())
      .digest('hex'),
    orders: {
      execute: (input) => this.checkoutUseCase.execute(input as never),
    },
    reservations: {
      execute: async (order) => {
        const outcome = await this.reserveInventoryForOrderUseCase.execute(order);
        return {
          state: outcome.state,
          code: outcome.code,
          fullyReserved: outcome.fullyReserved,
          warnings: outcome.warnings,
        };
      },
    },
    orderReader: {
      findById: (orderId) => this.orderRepo.findById(orderId),
      reservationStateOf: (orderId) => this.orderReservationState.getReservationState(orderId),
    },
    observer: {
      // Metric + audit, with no customer data: these lines are retained far
      // longer than the request.
      onLeaseLost: (stage, traceId) =>
        logger.warn({ stage, traceId }, 'CHECKOUT_LEASE_LOST'),
      onSideEffectFailed: (stage, traceId, message) =>
        logger.error({ stage, traceId, message }, 'CHECKOUT_SIDE_EFFECT_FAILED'),
    },
  });
  public readonly setProductStockUseCase = new SetProductStockUseCase(this.inventoryRepo);
  public readonly reserveInventoryForOrderUseCase = new ReserveInventoryForOrderUseCase({
    repo: this.inventoryRepo,
    orderState: this.orderReservationState,
    // Retry exhaustion and blocked stock are operational events, not noise. The
    // order id is safe to log; no customer detail is included.
    onAlert: (alert) =>
      logger.error(
        {
          orderId: alert.orderId,
          code: alert.code,
          attempts: alert.attempts,
          detail: alert.detail,
        },
        'INVENTORY_RESERVATION_ALERT',
      ),
  });
  public readonly releaseInventoryForOrderUseCase = new ReleaseInventoryForOrderUseCase(this.inventoryRepo);
  public readonly consumeInventoryForOrderUseCase = new ConsumeInventoryForOrderUseCase(this.inventoryRepo);
  public readonly getInventoryAvailabilityUseCase = new GetInventoryAvailabilityUseCase(this.inventoryRepo);
  public readonly listLowStockUseCase = new ListLowStockUseCase(this.inventoryRepo);

  // Fulfilment F4: dispatch tracking (stock consumed once at READY_FOR_DISPATCH).
  public readonly fulfilmentDispatchRepo = new DrizzleFulfilmentDispatchRepository();
  public readonly getDispatchUseCase = new GetDispatchUseCase(this.fulfilmentRepo, this.fulfilmentDispatchRepo);
  public readonly recordDispatchUseCase = new RecordDispatchUseCase(this.fulfilmentRepo, this.fulfilmentDispatchRepo, this.inventoryRepo, this.auditRepo);
  public readonly updateDispatchTrackingUseCase = new UpdateDispatchTrackingUseCase(this.fulfilmentDispatchRepo, this.auditRepo);

  // Fulfilment F5: delivery confirmation and pipeline reporting.
  public readonly fulfilmentDeliveryRepo = new DrizzleFulfilmentDeliveryRepository();
  public readonly fulfilmentReportRepo = new DrizzleFulfilmentReportRepository();
  public readonly getDeliveryHistoryUseCase = new GetDeliveryHistoryUseCase(this.fulfilmentRepo, this.fulfilmentDeliveryRepo);
  public readonly recordDeliveryUseCase = new RecordDeliveryUseCase(this.fulfilmentRepo, this.fulfilmentDeliveryRepo, this.auditRepo, this.orderTransitionService);
  public readonly getFulfilmentReportUseCase = new GetFulfilmentReportUseCase(this.fulfilmentReportRepo);

  // Customer DNA & NBA: canonical profile projection + next-best action.
  public readonly customerProfileRepo = new DrizzleCustomerProfileRepository();
  public readonly customerIdentityRepo = new DrizzleCustomerIdentityRepository();
  public readonly customerFeatureRepo = new DrizzleCustomerFeatureRepository();
  public readonly customerLifecycleRepo = new DrizzleCustomerLifecycleRepository();
  public readonly nbaDecisionRepo = new DrizzleNbaDecisionRepository();
  public readonly customerSignalReader = new DrizzleCustomerSignalReader();
  public readonly resolveCustomerIdentityUseCase = new ResolveCustomerIdentityUseCase(this.customerProfileRepo, this.customerIdentityRepo, this.auditRepo);
  public readonly projectCustomerProfileUseCase = new ProjectCustomerProfileUseCase(this.customerProfileRepo, this.customerIdentityRepo, this.customerFeatureRepo, this.customerLifecycleRepo, this.customerSignalReader, this.auditRepo);
  public readonly generateNextBestActionUseCase = new GenerateNextBestActionUseCase(this.customerProfileRepo, this.nbaDecisionRepo, this.auditRepo);
  public readonly getCustomerDnaUseCase = new GetCustomerDnaUseCase(this.customerProfileRepo, this.customerIdentityRepo, this.customerFeatureRepo, this.customerLifecycleRepo, this.nbaDecisionRepo);

  // Decision Intelligence: evidence-first explainable operational insights.
  public readonly decisionEvidenceReader = new DrizzleDecisionEvidenceReader();
  public readonly decisionInsightRepo = new DrizzleDecisionInsightRepository();
  public readonly evaluateDecisionSignalsBatchUseCase = new EvaluateDecisionSignalsBatchUseCase(this.decisionEvidenceReader, this.decisionInsightRepo, this.auditRepo);
  public readonly getDecisionInsightUseCase = new GetDecisionInsightUseCase(this.decisionInsightRepo);
  public readonly listDecisionInsightsUseCase = new ListDecisionInsightsUseCase(this.decisionInsightRepo);
  public readonly getDecisionOverviewUseCase = new GetDecisionOverviewUseCase(this.decisionInsightRepo);
  public readonly transitionDecisionInsightUseCase = new TransitionDecisionInsightUseCase(this.decisionInsightRepo, this.auditRepo);
  public readonly recomputeDecisionInsightUseCase = new RecomputeDecisionInsightUseCase(this.decisionInsightRepo, this.evaluateDecisionSignalsBatchUseCase);

  // Commerce Analytics: bounded server-side aggregation behind analytics.read.
  public readonly analyticsReadRepo = new DrizzleAnalyticsReadRepository();
  public readonly getAnalyticsOverviewUseCase = new GetAnalyticsOverviewUseCase(
    this.analyticsReadRepo,
    () => this.getDecisionOverviewUseCase.execute(),
  );
  public readonly getAnalyticsMetricSeriesUseCase = new GetAnalyticsMetricSeriesUseCase(this.analyticsReadRepo);
  public readonly getAnalyticsDataQualityUseCase = new GetAnalyticsDataQualityUseCase(this.analyticsReadRepo);
  // Operator configuration. Alert evaluation raises internal actions only —
  // there is no destination column and no delivery path.
  public readonly analyticsSavedViewRepo = new DrizzleAnalyticsSavedViewRepository();
  public readonly analyticsAlertRuleRepo = new DrizzleAnalyticsAlertRuleRepository();
  public readonly manageAnalyticsSavedViewsUseCase = new ManageAnalyticsSavedViewsUseCase(this.analyticsSavedViewRepo);
  public readonly manageAnalyticsAlertRulesUseCase = new ManageAnalyticsAlertRulesUseCase(this.analyticsAlertRuleRepo);
  public readonly evaluateAnalyticsAlertRulesUseCase = new EvaluateAnalyticsAlertRulesUseCase(
    this.analyticsAlertRuleRepo,
    this.getAnalyticsOverviewUseCase,
  );
  public readonly exportAnalyticsUseCase = new ExportAnalyticsUseCase(this.getAnalyticsOverviewUseCase);
  public readonly getPaymentIntelligenceUseCase = new GetPaymentIntelligenceUseCase(this.analyticsReadRepo);
  public readonly getAnalyticsBreakdownUseCase = new GetAnalyticsBreakdownUseCase(this.analyticsReadRepo);
  public readonly getAnalyticsExceptionDrilldownUseCase = new GetAnalyticsExceptionDrilldownUseCase(this.analyticsReadRepo);

  // Automation A2/A3: planning, deterministic gates, native internal effects,
  // and atomic existing-outbox intents. Providers remain behind the outbox.
  public readonly automationRepo = new DrizzleAutomationRepository();
  public readonly automationExecutionRepo = new DrizzleAutomationExecutionRepository();
  public readonly automationAudienceReader = new DrizzleAutomationAudienceReader();
  public readonly planAutomationExecutionUseCase = new PlanAutomationExecutionUseCase(this.automationRepo, this.automationExecutionRepo, this.automationAudienceReader);
  public readonly automationEligibilityRepo = new DrizzleAutomationEligibilityRepository();
  public readonly evaluateExecutionEligibilityUseCase = new EvaluateExecutionEligibilityUseCase(this.automationEligibilityRepo);
  public readonly automationInternalActionExecutor = new AutomationInternalActionExecutor(this.orderRepo, this.createFulfilmentTaskOnOrderPlacedUseCase);
  public readonly executeAutomationActionUseCase = new ExecuteAutomationActionUseCase(this.evaluateExecutionEligibilityUseCase, this.automationActionRepo, this.automationInternalActionExecutor);
  public readonly replayAutomationActionUseCase = new ReplayAutomationActionUseCase(this.automationActionRepo, this.outboxRepo, this.automationAudienceReader, this.evaluateExecutionEligibilityUseCase);
  public readonly reconcileAutomationOutcomeUseCase = new ReconcileAutomationOutcomeUseCase(this.automationActionRepo);
  public readonly automationOperationsUseCase = new AutomationOperationsUseCase(
    this.automationOperationsRepo,
    this.automationAudienceReader,
    this.executeAutomationActionUseCase,
    this.replayAutomationActionUseCase,
    this.reconcileAutomationOutcomeUseCase,
    this.createAuditLogUseCase,
  );
  public readonly experimentOperationsUseCase = new ExperimentOperationsUseCase(this.experimentRepo, this.createAuditLogUseCase);
  public readonly fraudTriageOperationsUseCase = new FraudTriageOperationsUseCase(this.fraudTriageRepo);
  public readonly pimImportOperationsUseCase = new PimImportOperationsUseCase(this.pimImportRepo);
  public readonly surveyOperationsUseCase = new SurveyOperationsUseCase(this.surveyRepo);
  public readonly getCopyQualityReportUseCase = new GetCopyQualityReportUseCase(this.copyQualityCatalog);
  public readonly behaviouralInterventionOperationsUseCase = new BehaviouralInterventionOperationsUseCase(this.behaviouralInterventionRepo);
  public readonly listDeliveryZonesUseCase = new ListDeliveryZonesUseCase(this.deliveryZoneRepo);
  public readonly upsertDeliveryZoneUseCase = new UpsertDeliveryZoneUseCase(this.deliveryZoneRepo);
  public readonly deleteDeliveryZoneUseCase = new DeleteDeliveryZoneUseCase(this.deliveryZoneRepo);

  // ── Location module (brief PART F) ──────────────────────────────────────
  public readonly locationSearchRepo = new DrizzleLocationSearchRepository();
  public readonly locationOrderDensityReader = new DrizzleLocationOrderDensityReader();
  public readonly searchMissRecorder = new DrizzleSearchMissRecorder();
  public readonly customerLocationContextReader = new DrizzleCustomerLocationContextReader();
  public readonly locationSearchService = new LocationSearchService(this.locationSearchRepo, this.locationOrderDensityReader);
  public readonly searchLocationsUseCase = new SearchLocationsUseCase(this.locationSearchService, this.searchMissRecorder);
  public readonly recordLocationSearchEventUseCase = new RecordLocationSearchEventUseCase(this.searchMissRecorder);
  public readonly resolveMapLinkUseCase = new ResolveMapLinkUseCase(new HttpShortLinkResolver());
  public readonly locationAdminRepo = new DrizzleLocationAdminRepository();
  public readonly listSearchMissesUseCase = new ListSearchMissesUseCase(this.locationAdminRepo);
  public readonly promoteSearchMissToAliasUseCase = new PromoteSearchMissToAliasUseCase(this.locationAdminRepo);
  public readonly listAddressReviewQueueUseCase = new ListAddressReviewQueueUseCase(this.locationAdminRepo, this.addressAuditRepo);
  public readonly resolveAddressUseCase = new ResolveAddressUseCase(this.locationAdminRepo, this.addressAuditRepo);
  public readonly manageLandmarksUseCase = new ManageLandmarksUseCase(this.locationAdminRepo);
  public readonly managePickupPointsUseCase = new ManagePickupPointsUseCase(this.locationAdminRepo);
  public readonly getZonePoliciesUseCase = new GetZonePoliciesUseCase(this.locationAdminRepo);
  public readonly saveZonePolicyUseCase = new SaveZonePolicyUseCase(this.locationAdminRepo);
  public readonly listDataExceptionsUseCase = new ListDataExceptionsUseCase(this.locationAdminRepo);

  // ── Loyalty completion (loyalty brief stages 2–4) ───────────────────────
  public readonly loyaltyCompletionRepo = new DrizzleLoyaltyCompletionRepository();
  public readonly loyaltyOutboxNotifier = new LoyaltyOutboxNotifier();
  public readonly vestLoyaltyOnDeliveryUseCase = new VestLoyaltyOnDeliveryUseCase(
    this.earnLoyaltyPointsUseCase,
    this.orderRepo,
    this.loyaltyCompletionRepo,
  );
  public readonly clawbackOrderEarnUseCase = new ClawbackOrderEarnUseCase(this.loyaltyRepo, this.loyaltyCompletionRepo, this.auditRepo);
  public readonly reserveRedemptionUseCase = new ReserveRedemptionUseCase(this.loyaltyRepo, this.loyaltyCompletionRepo, this.loyaltyGate);
  public readonly consumeRedemptionUseCase = new ConsumeRedemptionUseCase(this.loyaltyRepo, this.loyaltyCompletionRepo);
  public readonly releaseRedemptionUseCase = new ReleaseRedemptionUseCase(this.loyaltyCompletionRepo);
  public readonly reverseRedemptionUseCase = new ReverseRedemptionUseCase(this.loyaltyRepo, this.loyaltyCompletionRepo);
  public readonly runLoyaltyDailySweepUseCase = new RunLoyaltyDailySweepUseCase(
    this.loyaltyRepo,
    this.loyaltyCompletionRepo,
    async ({ userId, earnEntryId, kind, pointsExpiring, expiresAt }) =>
      this.loyaltyOutboxNotifier.enqueue({
        userId,
        eventType: 'LOYALTY_EXPIRY_WARNING',
        idempotencyKey: `loyexp:${earnEntryId}:${kind}`,
        data: { kind, pointsExpiring, expiresAt: expiresAt.toISOString() },
      }),
  );
  // Delivery intelligence: geography prior + order-book posterior; zones stay
  // the only source of CONFIRMED fees.
  public readonly deliveryPricingPolicyRepo = new DrizzleDeliveryPricingPolicyRepository();
  public readonly deliveryFeeObservationReader = new DrizzleDeliveryFeeObservationReader();
  public readonly getDeliveryEstimateUseCase = new GetDeliveryEstimateUseCase({
    zones: this.deliveryZoneRepo,
    policy: this.deliveryPricingPolicyRepo,
    observations: this.deliveryFeeObservationReader,
  });
  public readonly getDeliveryIntelligenceUseCase = new GetDeliveryIntelligenceUseCase({
    zones: this.deliveryZoneRepo,
    policy: this.deliveryPricingPolicyRepo,
    observations: this.deliveryFeeObservationReader,
  });
  public readonly saveDeliveryPricingPolicyUseCase = new SaveDeliveryPricingPolicyUseCase(this.deliveryPricingPolicyRepo);
  public readonly getProductListUseCase = new GetProductListUseCase(this.productRepo);
  public readonly getOrderListUseCase = new GetOrderListUseCase(this.orderRepo);
  public readonly getOrderByIdUseCase = new GetOrderByIdUseCase(this.orderRepo);
  public readonly verificationCheckUseCase = new VerificationCheckUseCase(this.verificationRepo);
  public readonly dealerApplicationUseCase = new DealerApplicationUseCase(this.dealerRepo);
  public readonly listAdminUsersUseCase = new ListAdminUsersUseCase(this.adminUserReadRepo);
  public readonly listAdminRolesUseCase = new ListAdminRolesUseCase(this.adminRoleReadRepo);
  public readonly recordNotificationAttemptUseCase = new RecordNotificationAttemptUseCase(this.notificationAttemptRepo);
  public readonly listRecentNotificationsUseCase = new ListRecentNotificationsUseCase(this.notificationAttemptRepo);
  public readonly listOrderNotificationsUseCase = new ListOrderNotificationsUseCase(this.outboxRepo, this.notificationAttemptRepo);
  // Transactional admin order email (reuses the outbox + ProcessOutboxBatch + ZeptoMail).
  public readonly enqueueAdminOrderEmailUseCase = new EnqueueAdminOrderEmailUseCase(this.outboxRepo);
  public readonly replayAdminOrderEmailUseCase = new ReplayAdminOrderEmailUseCase(this.outboxRepo, this.auditRepo);
  public readonly uploadProductImagesUseCase = new UploadProductImagesUseCase(this.productImageStorage, this.productImageRepo);
  public readonly processOutboxBatchUseCase = new ProcessOutboxBatchUseCase(
    this.outboxRepo,
    this.notificationRouter,
    this.recordNotificationAttemptUseCase
  );

  /**
   * Performs the commerce work checkout queued durably.
   *
   * These handlers used to run inline inside the checkout request, with a failure
   * reported to an observer while the checkout reported success — so a crash after
   * the order committed lost the fulfilment task entirely. They now run here, off
   * the request, where a failure is retried and an unrecoverable one is
   * dead-lettered instead of disappearing.
   *
   * Each handler must tolerate being called again: the outbox guarantees
   * at-least-once, and both underlying use cases are idempotent by order id.
   */
  public readonly processCheckoutSideEffectBatchUseCase =
    new ProcessCheckoutSideEffectBatchUseCase(
      this.outboxRepo,
      {
        ORDER_FULFILMENT_REQUIRED: {
          handle: async (event) => {
            const order = await this.orderRepo.findById(event.orderId);
            // A queued event naming an order that does not exist cannot be fixed
            // by waiting.
            if (!order) return { status: 'FINAL', error: 'ORDER_NOT_FOUND' };
            await this.createFulfilmentTaskOnOrderPlacedUseCase.execute(order, {
              extraWarnings: Array.isArray(event.payload.warnings)
                ? (event.payload.warnings as string[])
                : [],
              hold: event.payload.hold === true,
            });
            return { status: 'HANDLED' };
          },
        },
        ORDER_ADMIN_NOTIFICATION_REQUIRED: {
          handle: async (event) => {
            const order = await this.orderRepo.findById(event.orderId);
            if (!order) return { status: 'FINAL', error: 'ORDER_NOT_FOUND' };
            await this.enqueueAdminOrderEmailUseCase.execute({
              order,
              event: 'placed',
              stockConfirmed: event.payload.stockConfirmed === true,
            });
            return { status: 'HANDLED' };
          },
        },
      },
      {
        // No customer data: an unhandled type and a dead letter are both operator
        // alerts, and these lines outlive the request by far.
        onUnhandledType: (eventType, eventId) =>
          logger.error({ eventType, eventId }, 'CHECKOUT_SIDE_EFFECT_NO_HANDLER'),
        onDeadLettered: (eventType, eventId, error) =>
          logger.error({ eventType, eventId, error }, 'CHECKOUT_SIDE_EFFECT_DEAD_LETTERED'),
      },
    );

  public readonly trackRecommendationEventUseCase = new TrackRecommendationEventUseCase(
    this.recommendationEventRepo
  );

    private readonly recommendationRuleConflictService = new RecommendationRuleConflictService();
    public readonly recommendationRuleApplicationService = new RecommendationRuleApplicationService(
      this.recommendationRuleRepo,
      this.recommendationEligibility,
      this.recommendationRuleConflictService,
    );
    
    public readonly getRecommendationsUseCase = new GetRecommendationsUseCase(
      this.productRecommendationReader,
      this.recommendationSignalExtractor,
      this.recommendationScoring,
      this.recommendationTrending,
      this.recommendationFallback,
      this.recommendationEligibility,
      this.recommendationDedupe,
      this.recommendationDiversity,
      this.recommendationRuleApplicationService,
    );

  public readonly getRecentlyViewedUseCase = new GetRecentlyViewedUseCase(
    this.recommendationEventRepo,
    this.productRecommendationReader,
    this.recommendationSignalExtractor,
    this.recommendationEligibility
  );

  public readonly startPesaPalPaymentUseCase = new StartPesaPalPaymentUseCase(
    this.pesapalPaymentRepo,
    this.orderRepo,
    this.pesapalClient
  );

  public readonly verifyPesaPalPaymentUseCase = new VerifyPesaPalPaymentUseCase(
    this.pesapalPaymentRepo,
    this.pesapalClient,
    this.orderTransitionService
  );

  /**
   * Payment settlement, in ONE place.
   *
   * The callback and IPN routes each held the same ~100 lines of settlement
   * orchestration. Two copies of a payment path drift, and the drift is invisible: an
   * order settled by IPN would quietly differ from one settled by the browser callback.
   */
  public readonly reconcileOrderPaymentUseCase = new ReconcileOrderPaymentUseCase({
    idempotency: this.checkoutIdempotencyRepo,
    sideEffectRecorder: this.checkoutSideEffectRecorder,
    observer: {
      // Order ids and codes only. A settlement is financially significant and these
      // lines outlive the request; no customer or payment detail belongs in them.
      onSettled: (orderId, kind, traceId) =>
        logger.info({ orderId, kind, traceId }, 'PAYMENT_SETTLED'),
      onReviewRequired: (orderId, traceId, reason) =>
        logger.error({ orderId, traceId, reason }, 'PAYMENT_REVIEW_REQUIRED'),
    },
  });
  /**
   * Authorized, idempotent payment start.
   *
   * Wraps the PesaPal starter rather than replacing it: the provider mechanics are
   * unchanged, but ownership is checked against the server's own record of which
   * checkout produced the order, an existing live attempt is reused instead of
   * submitting a second transaction, and outcomes are typed so the route stops
   * returning internal error text on a blanket 400.
   */
  public readonly startOrderPaymentUseCase = new StartOrderPaymentUseCase({
    idempotency: this.checkoutIdempotencyRepo,
    orders: {
      findById: async (orderId) => {
        const order = await this.orderRepo.findById(orderId);
        return order ? { id: order.id, paymentStatus: order.paymentStatus } : null;
      },
    },
    attempts: {
      findAttemptsByOrderId: (orderId) => this.pesapalPaymentRepo.findAttemptsByOrderId(orderId),
    },
    provider: {
      execute: (input) => this.startPesaPalPaymentUseCase.execute(input),
    },
    sideEffectRecorder: this.checkoutSideEffectRecorder,
    observer: {
      // Order ids and codes only. A refused payment start is a security-relevant
      // event and these lines outlive the request; no customer data belongs in them.
      onForbidden: (orderId, traceId) =>
        logger.warn({ orderId, traceId }, 'PAYMENT_START_FORBIDDEN'),
      onNotPayable: (orderId, traceId, stage) =>
        logger.warn({ orderId, traceId, stage }, 'PAYMENT_START_NOT_PAYABLE'),
      onProviderFailure: (orderId, traceId, code) =>
        logger.error({ orderId, traceId, code }, 'PAYMENT_START_PROVIDER_FAILED'),
    },
  });


  public readonly checkSystemHealthUseCase = new CheckSystemHealthUseCase(
    this.systemHealthRepo
  );

  public readonly syntheticMonitor = new SyntheticMonitor();
  public readonly recommendationMaterializer = new RecommendationMaterializer();

  // Measurement Use Cases
  public readonly getMeasurementOverviewUseCase = new GetMeasurementOverviewUseCase(
    this.measurementAdminRepo,
    this.dlqRepo,
    this.attributionRepo
  );
  public readonly listMeasurementDlqUseCase = new ListMeasurementDlqUseCase(this.dlqRepo);
  public readonly replayMeasurementDlqUseCase = new ReplayMeasurementDlqUseCase(
    this.dlqRepo,
    this.measurementAdminRepo,
    this.measurementLogger,
    this.auditRepo
  );
  public readonly listConsentAuditUseCase = new ListConsentAuditUseCase(this.consentReadRepo);
  public readonly getMatchQualitySummaryUseCase = new GetMatchQualitySummaryUseCase(this.attributionRepo);
  public readonly attributionService = new AttributionService(this.attributionRepo, this.measurementLogger);
  public readonly consentService = new ConsentService(this.consentRepo, this.measurementLogger);
  public readonly consentAwareMeasurementPolicy = new ConsentAwareMeasurementPolicy(this.consentService);
  public readonly captureZeroPartyDataUseCase = new CaptureZeroPartyDataUseCase(this.zpdRepo, this.measurementLogger, this.consentService);

  public readonly planGtmMeasurementChangesUseCase = new PlanGtmMeasurementChangesUseCase(this.gtmRepo, this.gtmPlanRepo, this.gtmPlanBuilder);
  public readonly listGtmWorkspacesUseCase = new ListGtmWorkspacesUseCase(this.gtmRepo);
  public readonly validateGtmMeasurementPlanUseCase = new ValidateGtmMeasurementPlanUseCase(this.gtmRepo, this.gtmPlanBuilder, this.gtmDiffService);
  public readonly createGtmWorkspaceUseCase = new CreateGtmWorkspaceUseCase(this.gtmRepo);
  public readonly createGtmVersionDraftUseCase = new CreateGtmVersionDraftUseCase(this.gtmRepo);
  public readonly listGtmSyncLogsUseCase = new ListGtmSyncLogsUseCase(this.gtmPlanRepo);

  public readonly routePaidSocialEventUseCase = new RoutePaidSocialEventUseCase(
    this.paidSocialDestinationRepo,
    this.measurementQueuePort,
    this.consentService,
    this.measurementLogger
  );
  
  public readonly paidSocialDestinationMapperRegistry = new PaidSocialDestinationMapperRegistry([
    new MetaCapiMapper(this.hashingService),
    new TikTokEventsMapper(this.hashingService),
    new XConversionMapper(this.hashingService),
    new LinkedInConversionMapper(this.hashingService),
    new PinterestConversionMapper(this.hashingService),
    new SnapchatConversionMapper(this.hashingService),
    new GoogleAdsMeasurementMapper(this.hashingService),
    new PostHogMeasurementMapper(this.hashingService),
  ]);

  public readonly preparePaidSocialPayloadUseCase = new PreparePaidSocialPayloadUseCase(this.paidSocialDestinationMapperRegistry);
  public readonly deliverPaidSocialEventUseCase = new DeliverPaidSocialEventUseCase(this.measurementQueuePort);
  public readonly blockMeasurementEventUseCase = new BlockMeasurementEventUseCase(this.paidSocialDeliveryRepo);
  public readonly listPaidSocialDestinationsUseCase = new ListPaidSocialDestinationsUseCase(this.paidSocialDestinationRepo);
  public readonly getPaidSocialDeliveryHealthUseCase = new GetPaidSocialDeliveryHealthUseCase(this.paidSocialDeliveryRepo);
  public readonly retryPaidSocialDeliveryUseCase = new RetryPaidSocialDeliveryUseCase(this.paidSocialDeliveryRepo);
  public readonly updatePaidSocialDestinationUseCase = new UpdatePaidSocialDestinationUseCase(this.paidSocialDestinationRepo);

  public readonly capturePurchaseMeasurementUseCase = new CapturePurchaseMeasurementUseCase(this.paymentMeasurementRepo, this.hashingService);
  public readonly linkPaymentToAttributionTouchpointsUseCase = new LinkPaymentToAttributionTouchpointsUseCase(this.paymentAttributionRepo);
  public readonly reconcilePesapalOrderMeasurementUseCase = new ReconcilePesapalOrderMeasurementUseCase(
    this.paymentMeasurementRepo,
    this.capturePurchaseMeasurementUseCase,
    this.linkPaymentToAttributionTouchpointsUseCase,
    this.purchaseMeasurementQueue,
    this.consentAwareMeasurementPolicy,
    this.measurementLogger
  );
  public readonly getPaymentMeasurementReconciliationUseCase = new GetPaymentMeasurementReconciliationUseCase(this.paymentMeasurementRepo);
  public readonly listPaymentMeasurementReconciliationsUseCase = new ListPaymentMeasurementReconciliationsUseCase(this.paymentMeasurementRepo);
  public readonly retryPaymentMeasurementReconciliationUseCase = new RetryPaymentMeasurementReconciliationUseCase(this.paymentMeasurementRepo, this.purchaseMeasurementQueue);

  // Preference dependencies
  public readonly customerPreferenceRepo = new DrizzleCustomerPreferenceRepository();
  public readonly preferenceAuditRepo = new DrizzlePreferenceAuditRepository();
  public readonly preferencePublisher = new MeasurementPreferencePublisher(this.purchaseMeasurementQueue);

  public readonly recordPreferenceConsentChangeUseCase = new RecordPreferenceConsentChangeUseCase(
    this.consentService
  );
  public readonly getCustomerPreferenceCentreUseCase = new GetCustomerPreferenceCentreUseCase(
    this.customerPreferenceRepo,
    this.consentService
  );
  public readonly updateCustomerPreferenceCentreUseCase = new UpdateCustomerPreferenceCentreUseCase(
    this.customerPreferenceRepo,
    this.preferenceAuditRepo,
    this.preferencePublisher,
    this.recordPreferenceConsentChangeUseCase
  );
  public readonly getPreferenceAuditTrailUseCase = new GetPreferenceAuditTrailUseCase(
    this.preferenceAuditRepo,
    this.consentService
  );

  // Product Finder Dependencies
  public readonly productFinderRepo = new DrizzleProductFinderRepository();
  public readonly productFinderCatalogRepo = new DrizzleProductFinderCatalogRepository();
  public readonly productFinderRedactor = new ProductFinderRedactor();
  public readonly productFinderPublisher = new MeasurementProductFinderPublisher(
    this.genericMeasurementQueue,
    this.productFinderRedactor
  );
  public readonly productFinderPreferenceUpdater = new PreferenceProductFinderUpdater(
    this.updateCustomerPreferenceCentreUseCase
  );
  public readonly productFinderPricingReader = new PricingProductFinderReader(
    this.evaluateCartPricingUseCase
  );

  public readonly startProductFinderUseCase = new StartProductFinderUseCase(
    this.productFinderRepo,
    this.productFinderPublisher
  );
  public readonly answerProductFinderStepUseCase = new AnswerProductFinderStepUseCase(
    this.productFinderRepo,
    this.productFinderPublisher
  );
  public readonly completeProductFinderUseCase = new CompleteProductFinderUseCase(
    this.productFinderRepo,
    this.productFinderCatalogRepo,
    this.productFinderPublisher,
    this.productFinderPreferenceUpdater,
    this.productFinderPricingReader
  );
  public readonly getProductFinderRecommendationsUseCase = new GetProductFinderRecommendationsUseCase(
    this.productFinderRepo
  );
  public readonly recordProductFinderActionUseCase = new RecordProductFinderActionUseCase(
    this.productFinderRepo,
    this.productFinderPublisher
  );

  // Measurement Control Tower Dependencies
  public readonly measurementControlTowerRepo = new DrizzleMeasurementControlTowerRepository();
  public readonly measurementControlTowerAuditRepo = new DrizzleMeasurementControlTowerAuditRepository();
  public readonly measurementControlTowerAccessPolicy = new DefaultMeasurementControlTowerAccessPolicy();
  public readonly measurementControlTowerRedactor = new MeasurementControlTowerRedactor();
  public readonly measurementControlTowerMapper = new MeasurementControlTowerMapper();

  public readonly getMeasurementControlTowerSummaryUseCase = new GetMeasurementControlTowerSummaryUseCase(
    this.measurementControlTowerRepo,
    this.measurementControlTowerAccessPolicy
  );
  public readonly getMeasurementControlTowerSectionUseCase = new GetMeasurementControlTowerSectionUseCase(
    this.measurementControlTowerRepo,
    this.measurementControlTowerAccessPolicy
  );
  public readonly listMeasurementControlTowerWarningsUseCase = new ListMeasurementControlTowerWarningsUseCase(
    this.measurementControlTowerRepo,
    this.measurementControlTowerAccessPolicy,
    this.measurementControlTowerRedactor
  );
  public readonly listRecentMeasurementEventsUseCase = new ListRecentMeasurementEventsUseCase(
    this.measurementControlTowerRepo,
    this.measurementControlTowerAccessPolicy,
    this.measurementControlTowerRedactor
  );
  public readonly recordMeasurementControlTowerViewUseCase = new RecordMeasurementControlTowerViewUseCase(
    this.measurementControlTowerAuditRepo,
    this.measurementControlTowerAccessPolicy
  );

  // Release Readiness Dependencies
  public readonly releaseReadinessRepo = new DrizzleReleaseReadinessRepository();
  public readonly releaseReadinessAuditRepo = new DrizzleReleaseReadinessAuditRepository();
  public readonly releaseReadinessAccessPolicy = new DefaultReleaseReadinessAccessPolicy();
  public readonly releaseEvidenceRedactor = new DefaultReleaseEvidenceRedactor();
  public readonly releaseReadinessCheckRunner = new SafeReleaseReadinessCheckRunner(this.releaseEvidenceRedactor);

  public readonly getReleaseReadinessSummaryUseCase = new GetReleaseReadinessSummaryUseCase(
    this.releaseReadinessRepo,
    this.releaseReadinessAccessPolicy,
    this.releaseReadinessAuditRepo
  );
  public readonly runReleaseReadinessChecksUseCase = new RunReleaseReadinessChecksUseCase(
    this.releaseReadinessRepo,
    this.releaseReadinessCheckRunner,
    this.releaseReadinessAccessPolicy,
    this.releaseReadinessAuditRepo
  );
  public readonly getReleaseReadinessRunUseCase = new GetReleaseReadinessRunUseCase(
    this.releaseReadinessRepo,
    this.releaseReadinessAccessPolicy
  );
  public readonly listReleaseReadinessRunsUseCase = new ListReleaseReadinessRunsUseCase(
    this.releaseReadinessRepo,
    this.releaseReadinessAccessPolicy
  );
  public readonly recordReleaseDecisionUseCase = new RecordReleaseDecisionUseCase(
    this.releaseReadinessRepo,
    this.releaseReadinessAccessPolicy,
    this.releaseReadinessAuditRepo
  );
  public readonly acknowledgeReleaseGateUseCase = new AcknowledgeReleaseGateUseCase(
    this.releaseReadinessRepo,
    this.releaseReadinessAccessPolicy,
    this.releaseReadinessAuditRepo
  );

  // Controlled Activation
  public readonly controlledActivationRepo = new DrizzleControlledActivationRepository();
  public readonly controlledActivationAuditRepo = new DrizzleControlledActivationAuditRepository();
  public readonly activationStakeholderApprovalRepo = new DrizzleActivationStakeholderApprovalRepository();
  public readonly controlledActivationAccessPolicy = new DefaultControlledActivationAccessPolicy(this.adminRoleReadRepo);
  public readonly controlledActivationReadinessChecker = new SafeControlledActivationReadinessChecker(this.releaseReadinessRepo);
  public readonly activationEvidenceRedactor = new DefaultActivationEvidenceRedactor();
  public readonly controlledActivationMapper = new ControlledActivationMapper(this.activationEvidenceRedactor);

  public readonly createControlledActivationRequestUseCase = new CreateControlledActivationRequestUseCase(this.controlledActivationRepo, this.controlledActivationAuditRepo, this.controlledActivationAccessPolicy);
  public readonly getControlledActivationRequestUseCase = new GetControlledActivationRequestUseCase(this.controlledActivationRepo, this.controlledActivationAccessPolicy);
  public readonly getControlledActivationSummaryUseCase = new GetControlledActivationSummaryUseCase(this.controlledActivationRepo, this.controlledActivationAccessPolicy);
  public readonly listControlledActivationRequestsUseCase = new ListControlledActivationRequestsUseCase(this.controlledActivationRepo, this.controlledActivationAccessPolicy);
  public readonly runControlledActivationReadinessChecksUseCase = new RunControlledActivationReadinessChecksUseCase(this.controlledActivationRepo, this.controlledActivationAuditRepo, this.controlledActivationAccessPolicy, this.controlledActivationReadinessChecker);
  public readonly recordControlledActivationApprovalUseCase = new RecordControlledActivationApprovalUseCase(this.controlledActivationRepo, this.controlledActivationAuditRepo, this.controlledActivationAccessPolicy, this.controlledActivationReadinessChecker, this.activationStakeholderApprovalRepo);
  public readonly rejectControlledActivationRequestUseCase = new RejectControlledActivationRequestUseCase(this.controlledActivationRepo, this.controlledActivationAuditRepo, this.controlledActivationAccessPolicy, this.activationStakeholderApprovalRepo);
  public readonly cancelControlledActivationRequestUseCase = new CancelControlledActivationRequestUseCase(this.controlledActivationRepo, this.controlledActivationAuditRepo, this.controlledActivationAccessPolicy);
  public readonly acknowledgeActivationBlockerUseCase = new AcknowledgeActivationBlockerUseCase(this.controlledActivationAccessPolicy, this.controlledActivationReadinessChecker, this.controlledActivationAuditRepo);

  // Controlled Activation Dry Run (Phase 3 Slice 2)
  public readonly controlledActivationExecutionPlanRepo = new DrizzleControlledActivationExecutionPlanRepository();
  public readonly controlledActivationDryRunRepo = new DrizzleControlledActivationDryRunRepository();
  public readonly controlledActivationPayloadPreviewer = new DefaultControlledActivationPayloadPreviewer();
  public readonly controlledActivationEvidencePackBuilder = new DefaultControlledActivationEvidencePackBuilder();
  public readonly controlledActivationCanaryPlanner = new DefaultControlledActivationCanaryPlanner();

  public readonly createControlledActivationExecutionPlanUseCase = new CreateControlledActivationExecutionPlanUseCase(this.controlledActivationExecutionPlanRepo, this.controlledActivationRepo, this.controlledActivationReadinessChecker, this.controlledActivationAccessPolicy, this.controlledActivationAuditRepo);
  public readonly runControlledActivationDryRunUseCase = new RunControlledActivationDryRunUseCase(this.controlledActivationDryRunRepo, this.controlledActivationExecutionPlanRepo, this.controlledActivationAccessPolicy, this.controlledActivationAuditRepo, this.controlledActivationPayloadPreviewer);
  public readonly cancelControlledActivationDryRunUseCase = new CancelControlledActivationDryRunUseCase(this.controlledActivationDryRunRepo, this.controlledActivationExecutionPlanRepo, this.controlledActivationAuditRepo);
  public readonly generateDestinationPayloadPreviewsUseCase = new GenerateDestinationPayloadPreviewsUseCase(this.controlledActivationPayloadPreviewer);
  public readonly buildControlledActivationEvidencePackUseCase = new BuildControlledActivationEvidencePackUseCase(this.controlledActivationEvidencePackBuilder, this.controlledActivationDryRunRepo);
  public readonly validateControlledActivationCanaryPlanUseCase = new ValidateControlledActivationCanaryPlanUseCase(this.controlledActivationCanaryPlanner);

  // Controlled Activation Live Review (Phase 3 Slice 3)
  public readonly controlledActivationLiveReviewRepo = new DrizzleControlledActivationLiveReviewRepository();
  public readonly controlledActivationOperatorChecklistRepo = new DrizzleControlledActivationOperatorChecklistRepository();
  public readonly controlledActivationLiveApprovalRepo = new DrizzleControlledActivationStakeholderLiveApprovalRepository();
  public readonly controlledActivationIncidentPlanRepo = new DrizzleControlledActivationIncidentPlanRepository();
  public readonly controlledActivationLiveReadinessChecker = new DefaultControlledActivationLiveReadinessChecker();
  public readonly controlledActivationRunbookBuilder = new DefaultControlledActivationRunbookBuilder();

  public readonly createControlledActivationLiveReviewCandidateUseCase = new CreateControlledActivationLiveReviewCandidateUseCase(this.controlledActivationLiveReviewRepo, this.controlledActivationDryRunRepo, this.controlledActivationExecutionPlanRepo, this.controlledActivationAccessPolicy, this.controlledActivationAuditRepo);
  public readonly runControlledActivationLiveReadinessChecksUseCase = new RunControlledActivationLiveReadinessChecksUseCase(this.controlledActivationLiveReviewRepo, this.controlledActivationDryRunRepo, this.controlledActivationAccessPolicy, this.controlledActivationAuditRepo, this.controlledActivationLiveReadinessChecker, this.controlledActivationExecutionPlanRepo, this.buildControlledActivationEvidencePackUseCase, this.controlledActivationCanaryPlanner);
  public readonly buildControlledActivationRunbookUseCase = new BuildControlledActivationRunbookUseCase(this.controlledActivationLiveReviewRepo, this.controlledActivationAccessPolicy, this.controlledActivationAuditRepo, this.controlledActivationRunbookBuilder, this.controlledActivationCanaryPlanner, this.controlledActivationExecutionPlanRepo, this.controlledActivationIncidentPlanRepo);
  public readonly recordControlledActivationStakeholderLiveApprovalUseCase = new RecordControlledActivationStakeholderLiveApprovalUseCase(this.controlledActivationLiveReviewRepo, this.controlledActivationLiveApprovalRepo, this.controlledActivationAccessPolicy, this.controlledActivationAuditRepo);
  public readonly recordControlledActivationOperatorAcknowledgementUseCase = new RecordControlledActivationOperatorAcknowledgementUseCase(this.controlledActivationLiveReviewRepo, this.controlledActivationOperatorChecklistRepo, this.controlledActivationAccessPolicy, this.controlledActivationAuditRepo);
  public readonly cancelControlledActivationLiveReviewCandidateUseCase = new CancelControlledActivationLiveReviewCandidateUseCase(this.controlledActivationLiveReviewRepo, this.controlledActivationAccessPolicy, this.controlledActivationAuditRepo);
  public readonly expireControlledActivationLiveReviewCandidateUseCase = new ExpireControlledActivationLiveReviewCandidateUseCase(this.controlledActivationLiveReviewRepo, this.controlledActivationAuditRepo);
  public readonly getControlledActivationLiveReviewCandidateUseCase = new GetControlledActivationLiveReviewCandidateUseCase(this.controlledActivationLiveReviewRepo, this.controlledActivationOperatorChecklistRepo, this.controlledActivationRunbookBuilder, this.controlledActivationLiveApprovalRepo, this.controlledActivationIncidentPlanRepo, this.controlledActivationAccessPolicy);
  public readonly listControlledActivationLiveReviewCandidatesUseCase = new ListControlledActivationLiveReviewCandidatesUseCase(this.controlledActivationLiveReviewRepo, this.controlledActivationAccessPolicy);

  // Controlled Live Canary (Phase 3 Slice 3 FAST)
  public readonly controlledLiveCanaryRepo = new DrizzleControlledLiveCanaryRepository();
  public readonly controlledLiveCanaryAuditRepo = new DrizzleControlledLiveCanaryAuditRepository();
  public readonly controlledLiveCanaryTransport = new DefaultControlledLiveCanaryTransport();
  public readonly controlledLiveCanaryKillSwitch = new DefaultControlledLiveCanaryKillSwitch();
  public readonly controlledLiveCanaryEvidenceBuilder = new DefaultControlledLiveCanaryEvidenceBuilder();

  public readonly createControlledLiveCanaryUseCase = new CreateControlledLiveCanaryUseCase(this.controlledLiveCanaryRepo, this.controlledActivationDryRunRepo, this.controlledActivationAccessPolicy);
  public readonly evaluateControlledLiveCanaryEligibilityUseCase = new EvaluateControlledLiveCanaryEligibilityUseCase(this.controlledLiveCanaryRepo, this.controlledActivationDryRunRepo, this.controlledLiveCanaryKillSwitch);
  public readonly startControlledLiveCanaryUseCase = new StartControlledLiveCanaryUseCase(this.controlledLiveCanaryRepo, this.controlledLiveCanaryTransport, this.controlledLiveCanaryKillSwitch, this.controlledLiveCanaryAuditRepo);
  public readonly pauseControlledLiveCanaryUseCase = new PauseControlledLiveCanaryUseCase(this.controlledLiveCanaryRepo, this.controlledLiveCanaryAuditRepo);
  public readonly rollbackControlledLiveCanaryUseCase = new RollbackControlledLiveCanaryUseCase(this.controlledLiveCanaryRepo, this.controlledLiveCanaryAuditRepo);
  public readonly completeControlledLiveCanaryUseCase = new CompleteControlledLiveCanaryUseCase(this.controlledLiveCanaryRepo, this.controlledLiveCanaryAuditRepo);
  public readonly buildControlledLiveCanaryEvidencePackUseCase = new BuildControlledLiveCanaryEvidencePackUseCase(this.controlledLiveCanaryRepo, this.controlledLiveCanaryEvidenceBuilder);
  public readonly getControlledLiveCanaryUseCase = new GetControlledLiveCanaryUseCase(this.controlledLiveCanaryRepo);
  public readonly listControlledLiveCanariesUseCase = new ListControlledLiveCanariesUseCase(this.controlledLiveCanaryRepo);


  public static getInstance(): Registry {
    if (!Registry._instance) {
      Registry._instance = new Registry();
      Registry._instance.registerOrderTransitionSubscribers();
    }
    return Registry._instance;
  }

  /**
   * Loyalty ↔ order lifecycle wiring (loyalty brief PARTs F–G), registered
   * once at construction. Post-commit, isolated, idempotent:
   *  - delivered/completed → vest points (paid + signed-in orders only) and
   *    consume any COD redemption reservation attached to the order
   *  - cancelled → release any open reservation (points never eaten)
   *  - payment reversed (chargeback/refund) → claw back the earn in full and
   *    reverse an applied redemption, points returning with original expiry.
   */
  private registerOrderTransitionSubscribers(): void {
    this.orderTransitionService.onTransition(async ({ orderId, toStatus, ctx }) => {
      if (toStatus === 'delivered' || toStatus === 'completed') {
        await this.vestLoyaltyOnDeliveryUseCase.execute(orderId);
        await this.consumeRedemptionUseCase.execute({ orderId }).catch(() => undefined);
      }
      if (toStatus === 'cancelled') {
        await this.releaseRedemptionUseCase.execute({ orderId }).catch(() => undefined);
      }
      if (ctx.paymentStatus === 'reversed') {
        await this.clawbackOrderEarnUseCase
          .execute({ orderId, actorId: null, actorType: 'system', reason: 'Payment reversed by provider' })
          .catch(() => undefined);
        await this.reverseRedemptionUseCase.execute({ orderId, reason: 'Payment reversed by provider' }).catch(() => undefined);
      }
    });
  }
}
