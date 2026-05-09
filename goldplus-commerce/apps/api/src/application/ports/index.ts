import { ProductEntity } from '../../domain/products/ProductEntity';

export interface IProductRepository {
  findById(id: string): Promise<ProductEntity | null>;
  save(product: ProductEntity): Promise<void>;
}

export interface IEventPublisher {
  publish(eventType: string, payload: any): Promise<void>;
}
