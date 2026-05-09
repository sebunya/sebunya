import { db } from '../client';
import { carts, cartItems } from '../schema/commerce';
import { eq } from 'drizzle-orm';
import { Cart } from '../../../domain/commerce/Cart';

export class DrizzleCartRepository {
  async findById(id: string): Promise<Cart | null> {
    const result = await db.query.carts.findFirst({
      where: eq(carts.id, id),
      with: {
        items: {
          with: {
            product: true
          }
        }
      }
    });

    if (!result) return null;

    return new Cart(
      result.id,
      (result as any).items.map((item: any) => ({
        productId: item.productId,
        name: item.product.name,
        price: 0, // Price should be fetched from product price table in a real app
        quantity: item.quantity,
      }))
    );
  }

  async save(cart: Cart): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.insert(carts).values({
        id: cart.id,
      }).onConflictDoNothing();

      await tx.delete(cartItems).where(eq(cartItems.cartId, cart.id));
      
      for (const item of cart.items) {
        await tx.insert(cartItems).values({
          cartId: cart.id,
          productId: item.productId,
          quantity: item.quantity,
        });
      }
    });
  }
}
