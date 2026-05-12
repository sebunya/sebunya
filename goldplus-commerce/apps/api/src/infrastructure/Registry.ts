import { DrizzleCartRepository } from './db/repositories/DrizzleCartRepository';
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

import { DrizzleProductRecommendationReader } from './db/repositories/DrizzleProductRecommendationReader';
import { ScryptPasswordHasher } from './security/ScryptPasswordHasher';
import { Hs256TokenSigner } from './security/Hs256TokenSigner';

import { WhatsAppAdapter } from './notifications/whatsapp/WhatsAppAdapter';
import { ZeptoMailAdapter } from './notifications/zeptomail/ZeptoMailAdapter';
import { DisabledSmsAdapter } from './notifications/sms/DisabledSmsAdapter';
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
import { ProcessOutboxBatchUseCase } from '../application/use-cases/outbox/ProcessOutboxBatchUseCase';
import { UploadProductImagesUseCase } from '../application/use-cases/products/UploadProductImagesUseCase';
import { TrackRecommendationEventUseCase } from '../application/recommendations/TrackRecommendationEventUseCase';
import { GetRecommendationsUseCase } from '../application/recommendations/GetRecommendationsUseCase';
import { GetRecentlyViewedUseCase } from '../application/recommendations/GetRecentlyViewedUseCase';

export class Registry {
  private static _instance: Registry;
  
  // Repositories
  public readonly cartRepo = new DrizzleCartRepository();
  public readonly orderRepo = new DrizzleOrderRepository();
  public readonly productRepo = new DrizzleProductRepository();
  public readonly dealerRepo = new DrizzleDealerRepository();
  public readonly supportRepo = new DrizzleSupportRepository();
  public readonly quoteRepo = new DrizzleQuoteRepository();
  public readonly verificationRepo = new DrizzleVerificationRepository();
  public readonly auditRepo = new DrizzleAuditRepository();
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

  // Storage
  private readonly productImageStorage = new LocalProductImageStorage(
    path.join(process.cwd().endsWith('apps/api') ? process.cwd() : path.join(process.cwd(), 'apps', 'api'), '..', 'web', 'public')
  );

  public readonly adminUserReadRepo = new DrizzleAdminUserReadRepository();
  public readonly productImageRepo = new DrizzleProductImageRepository();
  public readonly attributeRepo = new DrizzleAttributeRepository();
  public readonly notificationAttemptRepo = new DrizzleNotificationAttemptRepository();
  public readonly outboxRepo = new DrizzleOutboxRepository();

  // Infrastructure Adapters
  public readonly whatsappAdapter = new WhatsAppAdapter();
  public readonly zeptoMailAdapter = new ZeptoMailAdapter();
  public readonly smsAdapter = new DisabledSmsAdapter();

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


  // Security Services
  public readonly passwordHasher = new ScryptPasswordHasher();
  public readonly tokenSigner = new Hs256TokenSigner();

  // Use Cases
  public readonly addToCartUseCase = new AddToCartUseCase(this.cartRepo);
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

  public static getInstance(): Registry {
    if (!Registry._instance) {
      Registry._instance = new Registry();
    }
    return Registry._instance;
  }
}
