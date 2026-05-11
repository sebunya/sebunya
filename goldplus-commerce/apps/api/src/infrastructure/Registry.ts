import { DrizzleCartRepository } from './db/repositories/DrizzleCartRepository';
import { DrizzleOrderRepository } from './db/repositories/DrizzleOrderRepository';
import { DrizzleProductRepository } from './db/repositories/DrizzleProductRepository';
import { DrizzleDealerRepository } from './db/repositories/DrizzleDealerRepository';
import { DrizzleSupportRepository } from './db/repositories/DrizzleSupportRepository';
import { DrizzleQuoteRepository } from './db/repositories/DrizzleQuoteRepository';
import { DrizzleVerificationRepository } from './db/repositories/DrizzleVerificationRepository';
import { DrizzleAuditRepository } from './db/repositories/DrizzleAuditRepository';
import { DrizzlePaymentRepository } from './db/repositories/DrizzlePaymentRepository';

import { AddToCartUseCase } from '../application/use-cases/commerce/AddToCartUseCase';
import { CheckoutUseCase } from '../application/use-cases/commerce/CheckoutUseCase';
import { VerificationCheckUseCase } from '../application/use-cases/VerificationCheckUseCase';
import { DealerApplicationUseCase } from '../application/use-cases/DealerApplicationUseCase';
import { GetProductListUseCase } from '../application/use-cases/commerce/GetProductListUseCase';
import { GetOrderListUseCase } from '../application/use-cases/commerce/GetOrderListUseCase';
import { GetOrderByIdUseCase } from '../application/use-cases/commerce/GetOrderByIdUseCase';

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

  // Use Cases
  public readonly addToCartUseCase = new AddToCartUseCase(this.cartRepo);
  public readonly checkoutUseCase = new CheckoutUseCase(this.orderRepo);
  public readonly getProductListUseCase = new GetProductListUseCase(this.productRepo);
  public readonly getOrderListUseCase = new GetOrderListUseCase(this.orderRepo);
  public readonly getOrderByIdUseCase = new GetOrderByIdUseCase(this.orderRepo);
  public readonly verificationCheckUseCase = new VerificationCheckUseCase(this.verificationRepo);
  public readonly dealerApplicationUseCase = new DealerApplicationUseCase(this.dealerRepo);

  public static getInstance(): Registry {
    if (!Registry._instance) {
      Registry._instance = new Registry();
    }
    return Registry._instance;
  }
}
