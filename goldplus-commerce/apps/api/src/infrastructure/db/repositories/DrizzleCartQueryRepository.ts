import { db } from '../client';
import { carts } from '../schema/commerce';
import { eq } from 'drizzle-orm';
import { ICartQueryRepository } from '../../../application/ports/ICartQueryRepository';

export class DrizzleCartQueryRepository implements ICartQueryRepository {
  public async getHydratedCart(id: string): Promise<any> {
    const cartRecord = await db.query.carts.findFirst({
      where: eq(carts.id, id),
      with: {
        items: {
          with: {
            product: true
          }
        }
      }
    });

    if (!cartRecord) {
      return {
        id,
        items: [],
        subtotalUgx: 0
      };
    }

    const items = (cartRecord.items || []).map((item: any) => ({
      productId: item.productId,
      slug: item.product.slug,
      name: item.product.name,
      categoryName: item.product.categoryName || null,
      quantity: item.quantity,
      unitPriceUgx: item.product.priceUgx || 0,
    }));

    const subtotalUgx = items.reduce(
      (acc: number, item: any) => acc + (item.unitPriceUgx * item.quantity), 
      0
    );

    return {
      id: cartRecord.id,
      items,
      subtotalUgx,
    };
  }
}
