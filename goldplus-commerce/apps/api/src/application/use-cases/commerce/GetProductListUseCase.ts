import { ProductEntity } from '../../../domain/products/ProductEntity';

export interface IProductReadOnlyRepository {
  findAll(): Promise<ProductEntity[]>;
}

export class GetProductListUseCase {
  constructor(
    private readonly productRepo: IProductReadOnlyRepository
  ) {}

  public async execute(): Promise<ProductEntity[]> {
    const products = await this.productRepo.findAll();
    // In a real app, filter for only 'approved' status and 'active'
    return products.filter(p => p.active && p.approvalStatus === 'approved');
  }
}
