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
import { DrizzleAddressRepository } from './db/repositories/DrizzleAddressRepository';
import { DrizzleRoleRepository } from './db/repositories/DrizzleRoleRepository';
import { DrizzleFakeReportRepository } from './db/repositories/DrizzleFakeReportRepository';
import { DrizzleAdminRoleReadRepository } from './db/repositories/DrizzleAdminRoleReadRepository';
import { DrizzleAdminUserReadRepository } from './db/repositories/DrizzleAdminUserReadRepository';
import { DrizzleProductImageRepository } from './db/repositories/DrizzleProductImageRepository';
import { DrizzleAttributeRepository } from './db/repositories/DrizzleAttributeRepository';
import { DrizzleNotificationAttemptRepository } from './db/repositories/DrizzleNotificationAttemptRepository';
import { DrizzleOutboxRepository } from './db/repositories/DrizzleOutboxRepository';
import { DrizzleActivityEventRepository } from './db/repositories/DrizzleActivityEventRepository';
import { DrizzleExperimentRepository } from './db/repositories/DrizzleExperimentRepository';
import { DrizzleLoyaltyLedgerRepository, DrizzleLoyaltyOrderLookup } from './db/repositories/DrizzleLoyaltyLedgerRepository';
import { ScryptPasswordHasher } from './security/ScryptPasswordHasher';
import { Hs256TokenSigner } from './security/Hs256TokenSigner';

import { WhatsAppAdapter } from './notifications/whatsapp/WhatsAppAdapter';
import { ZeptoMailAdapter } from './notifications/zeptomail/ZeptoMailAdapter';
import { DisabledSmsAdapter } from './notifications/sms/DisabledSmsAdapter';
import { DefaultNotificationRouter } from './notifications/NotificationRouter';

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
import { RecordActivityEventUseCase } from '../application/use-cases/engagement/RecordActivityEventUseCase';
import { GetEngagementSummaryUseCase } from '../application/use-cases/engagement/GetEngagementSummaryUseCase';
import { GetExperimentAssignmentUseCase } from '../application/use-cases/experimentation/GetExperimentAssignmentUseCase';
import {
  CreateExperimentUseCase,
  ListExperimentsUseCase,
  UpdateExperimentStatusUseCase,
} from '../application/use-cases/experimentation/ManageExperimentsUseCases';
import { AwardOrderLoyaltyPointsUseCase } from '../application/use-cases/loyalty/AwardOrderLoyaltyPointsUseCase';
import { GetLoyaltySummaryUseCase } from '../application/use-cases/loyalty/GetLoyaltySummaryUseCase';

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
  public readonly adminUserReadRepo = new DrizzleAdminUserReadRepository();
  public readonly productImageRepo = new DrizzleProductImageRepository();
  public readonly attributeRepo = new DrizzleAttributeRepository();
  public readonly notificationAttemptRepo = new DrizzleNotificationAttemptRepository();
  public readonly outboxRepo = new DrizzleOutboxRepository();
  public readonly activityEventRepo = new DrizzleActivityEventRepository();
  public readonly experimentRepo = new DrizzleExperimentRepository();
  public readonly loyaltyLedgerRepo = new DrizzleLoyaltyLedgerRepository();
  public readonly loyaltyOrderLookup = new DrizzleLoyaltyOrderLookup();

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
  public readonly processOutboxBatchUseCase = new ProcessOutboxBatchUseCase(
    this.outboxRepo,
    this.notificationRouter,
    this.recordNotificationAttemptUseCase
  );
  public readonly recordActivityEventUseCase = new RecordActivityEventUseCase(this.activityEventRepo);
  public readonly getEngagementSummaryUseCase = new GetEngagementSummaryUseCase(this.activityEventRepo);
  public readonly getExperimentAssignmentUseCase = new GetExperimentAssignmentUseCase(
    this.experimentRepo,
    this.activityEventRepo
  );
  public readonly createExperimentUseCase = new CreateExperimentUseCase(this.experimentRepo);
  public readonly listExperimentsUseCase = new ListExperimentsUseCase(this.experimentRepo);
  public readonly updateExperimentStatusUseCase = new UpdateExperimentStatusUseCase(this.experimentRepo);
  public readonly awardOrderLoyaltyPointsUseCase = new AwardOrderLoyaltyPointsUseCase(
    this.loyaltyLedgerRepo,
    this.loyaltyOrderLookup
  );
  public readonly getLoyaltySummaryUseCase = new GetLoyaltySummaryUseCase(this.loyaltyLedgerRepo);

  public static getInstance(): Registry {
    if (!Registry._instance) {
      Registry._instance = new Registry();
    }
    return Registry._instance;
  }
}
