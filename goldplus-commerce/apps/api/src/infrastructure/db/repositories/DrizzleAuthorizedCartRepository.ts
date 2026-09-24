import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { CartOwnerKind, CART_RETENTION_DAYS } from '@goldplus/shared';
import { db } from '../client';
import { carts, cartItems } from '../schema/commerce';
import { products, productPrices } from '../schema/products';
import {
  CartOwner,
  CartRecord,
  CartProductReader,
  ICartAuthorizedRepository,
} from '../../../application/use-cases/commerce/MutateCartUseCase';
import type { IAccountCartRepository } from '../../../application/use-cases/commerce/ResolveAccountCartUseCase';

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

/**
 * The ONE pricing rule for a basket line, the same as the public product DTO
 * (DrizzleProductRepository + toProductPublicDto): a product has a price only
 * when `has_retail_price` is true AND `product_prices` holds a positive whole
 * retail price. `products.price_ugx` is never a fallback: the storefront shows
 * such a product as "Price on request" and checkout refuses it
 * (PRICE_UNAVAILABLE), so pricing its cart line from price_ugx put a number in
 * the subtotal that the order would never charge.
 */
export function confirmedRetailPrice(hasRetailPrice: boolean | null | undefined, retailPrice: number | null | undefined): number | null {
  if (!hasRetailPrice) return null;
  return typeof retailPrice === 'number' && Number.isInteger(retailPrice) && retailPrice > 0 ? retailPrice : null;
}

// Same constant the credential cookie uses — cookie lifetime and row expiry move together.
const CART_TTL_DAYS = CART_RETENTION_DAYS;

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
        slug: products.slug,
        retailPrice: productPrices.retailPrice,
        hasRetailPrice: products.hasRetailPrice,
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
      items: lines.map((line) => {
        const price = confirmedRetailPrice(line.hasRetailPrice, line.retailPrice);
        return {
          productId: line.productId,
          name: line.name,
          slug: line.slug,
          unitPriceUgx: price ?? 0,
          quantity: line.quantity,
          // No confirmed price: out of the subtotal and named, as an
          // unpurchasable line is, instead of a price checkout will refuse.
          ...(price === null ? { unavailable: true } : {}),
        };
      }),
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
        hasRetailPrice: products.hasRetailPrice,
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
    // A product with no confirmed retail price cannot be bought (checkout
    // answers PRICE_UNAVAILABLE), so it is not purchasable here either.
    return rows.flatMap((row) => {
      const price = confirmedRetailPrice(row.hasRetailPrice, row.retailPrice);
      return price === null ? [] : [{ id: row.id, name: row.name, unitPriceUgx: price }];
    });
  }
}

/** Thrown inside a merge transaction to roll it back; never escapes the repository. */
class MergeRaceLost extends Error {}

/**
 * The account basket and the guest-basket merge (ResolveAccountCartUseCase).
 *
 * Both halves of the merge commit together: emptying the guest basket and
 * writing the account basket are one transaction, each guarded by its version,
 * so a second tab or a retry can never fold the same guest lines in twice.
 */
export class DrizzleAccountCartRepository implements IAccountCartRepository {
  async findLatestFor(owner: CartOwner, now: Date): Promise<{ id: string } | null> {
    const [row] = await db
      .select({ id: carts.id })
      .from(carts)
      .where(
        and(
          eq(carts.ownerKind, owner.kind),
          eq(carts.ownerId, owner.id),
          or(isNull(carts.expiresAt), gt(carts.expiresAt, now)),
        ),
      )
      .orderBy(desc(carts.updatedAt))
      .limit(1);
    return row ?? null;
  }

  async mergeInto(args: {
    guestCartId: string;
    guestVersion: number;
    targetCartId: string;
    targetOwner: CartOwner;
    targetExpectedVersion: number | null;
    items: Array<{ productId: string; quantity: number }>;
  }): Promise<boolean> {
    const now = new Date();
    try {
      await db.transaction(async (tx) => {
        const guest = await tx
          .update(carts)
          .set({ version: sql`${carts.version} + 1`, updatedAt: now })
          .where(and(eq(carts.id, args.guestCartId), eq(carts.version, args.guestVersion)))
          .returning({ id: carts.id });
        if (guest.length !== 1) throw new MergeRaceLost();

        if (args.targetExpectedVersion === null) {
          const created = await tx
            .insert(carts)
            .values({
              id: args.targetCartId,
              ownerKind: args.targetOwner.kind,
              ownerId: args.targetOwner.id,
              version: 1,
              updatedAt: now,
              expiresAt: new Date(now.getTime() + CART_TTL_DAYS * 24 * 60 * 60 * 1000),
            })
            .onConflictDoNothing()
            .returning({ id: carts.id });
          if (created.length !== 1) throw new MergeRaceLost();
        } else {
          const target = await tx
            .update(carts)
            .set({
              version: sql`${carts.version} + 1`,
              updatedAt: now,
              expiresAt: new Date(now.getTime() + CART_TTL_DAYS * 24 * 60 * 60 * 1000),
            })
            .where(
              and(
                eq(carts.id, args.targetCartId),
                eq(carts.version, args.targetExpectedVersion),
                eq(carts.ownerKind, args.targetOwner.kind),
                eq(carts.ownerId, args.targetOwner.id),
              ),
            )
            .returning({ id: carts.id });
          if (target.length !== 1) throw new MergeRaceLost();
        }

        await tx.delete(cartItems).where(eq(cartItems.cartId, args.guestCartId));
        await tx.delete(cartItems).where(eq(cartItems.cartId, args.targetCartId));
        if (args.items.length > 0) {
          await tx.insert(cartItems).values(
            args.items.map((item) => ({
              cartId: args.targetCartId,
              productId: item.productId,
              quantity: item.quantity,
            })),
          );
        }
      });
      return true;
    } catch (err) {
      if (err instanceof MergeRaceLost) return false;
      throw err;
    }
  }
}
