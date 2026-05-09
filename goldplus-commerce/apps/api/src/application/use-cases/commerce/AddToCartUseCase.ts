import { Cart, CartItem } from '../../../domain/commerce/Cart';

export interface ICartRepository {
  findById(id: string): Promise<Cart | null>;
  save(cart: Cart): Promise<void>;
}

export class AddToCartUseCase {
  constructor(private readonly cartRepo: ICartRepository) {}

  public async execute(cartId: string, item: CartItem): Promise<Cart> {
    let cart = await this.cartRepo.findById(cartId);
    if (!cart) {
      cart = new Cart(cartId, []);
    }
    const updatedCart = cart.addItem(item);
    await this.cartRepo.save(updatedCart);
    return updatedCart;
  }
}
