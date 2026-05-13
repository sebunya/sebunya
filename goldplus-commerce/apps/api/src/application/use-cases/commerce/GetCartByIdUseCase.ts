import { ICartQueryRepository } from '../../ports/ICartQueryRepository';

export class GetCartByIdUseCase {
  constructor(private readonly cartQueryRepo: ICartQueryRepository) {}

  /**
   * Retrieves a fully operational and rendered cart DTO by session ID, including PostgreSQL hydration.
   */
  public async execute(cartId: string): Promise<any> {
    if (!cartId) {
      throw new Error('Cart session ID is required.');
    }
    return this.cartQueryRepo.getHydratedCart(cartId);
  }
}
