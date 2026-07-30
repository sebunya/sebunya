import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { CartOwnerKind } from '@goldplus/shared';
import { db } from '../client';
import { carts, cartItems } from '../schema/commerce';
import { products, productPrices } from '../schema/products';
import {
  CartOwner,
  CartRecord,
  CartProductReader,
  ICartAuthorizedRepository,
} from '../../../application/use-cases/commerce/MutateCartUseCase';

/**
 * Cart persistence with ownership and optimistic concurrency.
 *
 * The previous repository had neither. `save()` deleted every item row and reinserted
 * the whole basket with no version check, so two tabs updating one cart raced and the
 * loser's change vanished silently — including a REMOVE undone by a concurrent
 * UPDATE, which puts an item the customer deleted back into the basket and then into
 * the order. It also wrote `price: 0` into the domain object and left the real price
 * to be looked up later, so nothing in the cart layer could compute a subtotal that
 * matched the order.
 *
 * Every write here is conditional. A statement that does not match returns zero rows
 * and the caller is told, rather than the write landing on whatever state it finds.
 */

const CART_TTL_DAYS = 30;

export class DrizzleAuthorizedCartRepository implements ICartAuthorizedRepository {
  async find(cartId: string): Promise<CartRecord | null> {
    const [cart] = await db
      .select({
        id: carts.id,
        version: carts.version,
        ownerKind: carts.ownerKind,
        ownerId: carts.ownerId,
      })
      .from(carts)
      .where(eq(carts.id, cartId))
      .limit(1);

    if (!cart) return null;

    // Priced from `product_prices`, which is the authority the order path uses. The
    // product row's own `price_ugx` is a display convenience and the two can differ;
    // reading the wrong one is how a cart subtotal comes to disagree with the order.
    const lines = await db
      .select({
        productId: cartItems.productId,
        quantity: cartItems.quantity,
        name: products.name,
        retailPrice: productPrices.retailPrice,
        fallbackPrice: products.priceUgx,
      })
      .from(cartItems)
      .innerJoin(products, eq(products.id, cartItems.productId))
      .leftJoin(productPrices, eq(productPrices.productId, cartItems.productId))
      .where(eq(cartItems.cartId, cartId));

    return {
      id: cart.id,
      version: cart.version,
      ownerKind: (cart.ownerKind as CartOwnerKind | null) ?? null,
      ownerId: cart.ownerId ?? null,
      items: lines.map((line) => ({
        productId: line.productId,
        name: line.name,
        unitPriceUgx: line.retailPrice ?? line.fallbackPrice,
        quantity: line.quantity,
      })),
    };
  }

  /**
   * Claims an unowned cart, and only while it is still unowned.
   *
   * `IS NULL` in the WHERE clause is what makes this safe under concurrency: two
   * first-touches cannot both claim it, because the second matches zero rows. A
   * read-then-write here would let two principals each believe they own the cart, and
   * both would then pass every later ownership check.
   */
  async claimOwnership(cartId: string, owner: CartOwner): Promise<boolean> {
    const now = new Date();
    const updated = await db
      .update(carts)
      .set({
        ownerKind: owner.kind,
        ownerId: owner.id,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + CART_TTL_DAYS * 24 * 60 * 60 * 1000),
      })
      .where(and(eq(carts.id, cartId), isNull(carts.ownerKind)))
      .returning({ id: carts.id });
    return updated.length === 1;
  }

  /**
   * Replaces the item set at a known version, in one transaction.
   *
   * The version bump and the item rewrite commit together. Split across two
   * statements, a crash between them would leave a cart whose contents changed while
   * its version claimed it had not — so every later writer would believe its stale
   * view was current.
   */
  async replaceItems(args: {
    cartId: string;
    expectedVersion: number;
    items: Array<{ productId: string; quantity: number }>;
  }): Promise<boolean> {
    return db.transaction(async (tx) => {
      // The version check comes FIRST, inside the transaction. If it does not match,
      // nothing is deleted — the previous code deleted the items before discovering
      // any problem, so a failure destroyed the basket.
      const bumped = await tx
        .update(carts)
        .set({ version: sql`${carts.version} + 1`, updatedAt: new Date() })
        .where(and(eq(carts.id, args.cartId), eq(carts.version, args.expectedVersion)))
        .returning({ id: carts.id });

      if (bumped.length !== 1) return false;

      await tx.delete(cartItems).where(eq(cartItems.cartId, args.cartId));

      if (args.items.length > 0) {
        await tx.insert(cartItems).values(
          args.items.map((item) => ({
            cartId: args.cartId,
            productId: item.productId,
            quantity: item.quantity,
          })),
        );
      }

      return true;
    });
  }

  /**
   * Creates a cart already owned.
   *
   * There is no unowned-creation path: a cart that exists without an owner is the
   * state migration 0060 had to tolerate for historical rows, not one worth creating.
   */
  async create(cartId: string, owner: CartOwner): Promise<void> {
    const now = new Date();
    await db
      .insert(carts)
      .values({
        id: cartId,
        ownerKind: owner.kind,
        ownerId: owner.id,
        version: 1,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + CART_TTL_DAYS * 24 * 60 * 60 * 1000),
      })
      .onConflictDoNothing();
  }
}

/**
 * Only products a customer may actually buy.
 *
 * `body.item` previously went to the repository unchecked, so a cart could hold an
 * inactive, unapproved or withdrawn product. The foreign key caught a fabricated id;
 * nothing caught a real id for a product that had been pulled, which then reached
 * pricing and checkout.
 */
export class DrizzleCartProductReader implements CartProductReader {
  async findPurchasable(
    productIds: readonly string[],
  ): Promise<Array<{ id: string; name: string; unitPriceUgx: number }>> {
    if (productIds.length === 0) return [];
    const rows = await db
      .select({
        id: products.id,
        name: products.name,
        retailPrice: productPrices.retailPrice,
        fallbackPrice: products.priceUgx,
      })
      .from(products)
      .leftJoin(productPrices, eq(productPrices.productId, products.id))
      .where(
        and(
          inArray(products.id, [...productIds]),
          eq(products.active, true),
          eq(products.approvalStatus, 'approved'),
        ),
      );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      unitPriceUgx: row.retailPrice ?? row.fallbackPrice,
    }));
  }
}
