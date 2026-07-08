import { DrizzleCartRepository } from './db/repositories/DrizzleCartRepository';
import { DrizzleCartQueryRepository } from './db/repositories/DrizzleCartQueryRepository';
import { DrizzleOrderRepository } from './db/repositories/DrizzleOrderRepository';
import { DrizzleProductRepository } from './db/repositories/DrizzleProductRepository';
import { DrizzleDealerRepository } from './db/repositories/DrizzleDealerRepository';
import { DrizzleSupportRepository } from './db/repositories/DrizzleSupportRepository';
import { DrizzleQuoteRepository } from './db/repositories/DrizzleQuoteRepository';
import { DrizzleVerificationRepository } from './db/repositories/DrizzleVerificationRepository';
import { DrizzleAuditRepository } from './db/repositories/DrizzleAuditRepository';
import { DrizzlePaymentRepository } from './db/repositories/DrizzlePaymentRepository';
import { DrizzleUserRepository } from './db/repositories/DrizzleUserRepository';
import { LocalProductImageStorage } from './storage/LocalProductImageStorage';
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
import { BullMqPurchaseMeasurementQueue } from './measurement/BullMqPurchaseMeasurementQueue';
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

export class Registry {
  private static _instance: Registry;
  
  // Repositories
  public readonly cartRepo = new DrizzleCartRepository();
  public readonly cartQueryRepo = new DrizzleCartQueryRepository();
  public readonly orderRepo = new DrizzleOrderRepository();
  public readonly productRepo = new DrizzleProductRepository();
  public readonly dealerRepo = new DrizzleDealerRepository();
  public readonly supportRepo = new DrizzleSupportRepository();
  public readonly quoteRepo = new DrizzleQuoteRepository();
  public readonly verificationRepo = new DrizzleVerificationRepository();
  public readonly auditRepo = new DrizzleAuditRepository();
  public readonly createAuditLogUseCase = new CreateAuditLogUseCase(this.auditRepo);
  public readonly paymentRepo = new DrizzlePaymentRepository();
  public readonly userRepo = new DrizzleUserRepository();
  public readonly addressRepo = new DrizzleAddressRepository();
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

  // Storage
  private readonly productImageStorage = new LocalProductImageStorage(
    path.join(process.cwd().endsWith('apps/api') ? process.cwd() : path.join(process.cwd(), 'apps', 'api'), '..', 'web', 'public')
  );

  public readonly adminUserReadRepo = new DrizzleAdminUserReadRepository();
  public readonly productImageRepo = new DrizzleProductImageRepository();
  public readonly attributeRepo = new DrizzleAttributeRepository();
  public readonly notificationAttemptRepo = new DrizzleNotificationAttemptRepository();
  public readonly outboxRepo = new DrizzleOutboxRepository();

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
    this.smsAdapter
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
  public readonly checkoutUseCase = new CheckoutUseCase(this.orderRepo);
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
  public readonly uploadProductImagesUseCase = new UploadProductImagesUseCase(this.productImageStorage, this.productImageRepo);
  public readonly processOutboxBatchUseCase = new ProcessOutboxBatchUseCase(
    this.outboxRepo,
    this.notificationRouter,
    this.recordNotificationAttemptUseCase
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
    this.pesapalClient
  );

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

  public static getInstance(): Registry {
    if (!Registry._instance) {
      Registry._instance = new Registry();
    }
    return Registry._instance;
  }
}
