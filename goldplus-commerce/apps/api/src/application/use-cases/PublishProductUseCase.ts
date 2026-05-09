import { IProductRepository, IEventPublisher } from '../ports';
import { DOMAIN_EVENTS } from '@goldplus/shared';

export class PublishProductUseCase {
  constructor(
    private readonly productRepo: IProductRepository,
    private readonly eventPublisher: IEventPublisher
  ) {}

  public async execute(productId: string, actorId: string): Promise<boolean> {
    const product = await this.productRepo.findById(productId);
    if (!product) throw new Error('Product not found');

    if (!product.canBePublished()) {
      throw new Error('Product does not meet publication criteria (missing price, image, or approval).');
    }

    // Business logic to update status would go here
    // ...

    await this.eventPublisher.publish(DOMAIN_EVENTS.AUDIT_LOG_CREATED, {
      actorId,
      action: 'PUBLISH_PRODUCT',
      entity: 'Product',
      entityId: productId,
    });

    return true;
  }
}
