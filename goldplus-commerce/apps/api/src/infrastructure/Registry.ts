import { DrizzleCartRepository } from './db/repositories/DrizzleCartRepository';
import { DrizzleOrderRepository } from './db/repositories/DrizzleOrderRepository';
import { DrizzleProductRepository } from './db/repositories/DrizzleProductRepository';
import { AddToCartUseCase } from '../application/use-cases/commerce/AddToCartUseCase';
import { CheckoutUseCase } from '../application/use-cases/commerce/CheckoutUseCase';

export class Registry {
  private static _instance: Registry;
  
  public readonly cartRepo = new DrizzleCartRepository();
  public readonly orderRepo = new DrizzleOrderRepository();
  public readonly productRepo = new DrizzleProductRepository();

  public readonly addToCartUseCase = new AddToCartUseCase(this.cartRepo);
  public readonly checkoutUseCase = new CheckoutUseCase(this.cartRepo, this.orderRepo);

  public static getInstance(): Registry {
    if (!Registry._instance) {
      Registry._instance = new Registry();
    }
    return Registry._instance;
  }
}
