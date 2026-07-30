import { CartOwnerKind } from '@goldplus/shared';

/**
 * Owns every cart mutation.
 *
 * WHAT WAS WRONG
 * The four cart routes held their logic inline and shared nothing: each read a
 * `cartId` from the request, loaded the cart, changed it and saved it. That produced
 * four separate places where authorization could be — and was — omitted, and it put
 * concurrency policy in a transport adapter.
 *
 * Two failures follow from the shape, independent of the missing authorization:
 *
 * 1. READ-MODIFY-WRITE WITH NO CONCURRENCY CONTROL. The repository deleted every
 *    item row and reinserted the basket. Two tabs updating one cart raced, and the
 *    loser's change vanished silently — including a REMOVE being undone by a
 *    concurrent UPDATE, which puts an item the customer deleted back in the basket
 *    and then in the order.
 *
 * 2. NO PRODUCT VALIDATION. `body.item` went to the repository unchecked, so a cart
 *    could hold an inactive, unapproved or non-existent product. The foreign key
 *    caught a fabricated id; nothing caught a real id for a withdrawn product, which
 *    then reached pricing and checkout.
 *
 * Outcomes are typed. A cart mutation has several expected non-success answers —
 * a stale version, an unavailable product, a quantity out of bounds — and `catch`
 * cannot tell them from a dropped connection.
 */

export type CartMutationKind =
  | { kind: 'ADD'; productId: string; quantity: number }
  | { kind: 'UPDATE'; productId: string; quantity: number }
  | { kind: 'REMOVE'; productId: string }
  | { kind: 'CLEAR' };

export type CartOutcomeKind =
  | 'APPLIED'
  /** The cart moved on since the caller read it. Re-read and retry. */
  | 'VERSION_CONFLICT'
  | 'CART_NOT_FOUND'
  /** Someone else owns this cart. Reported to the caller as NOT_FOUND. */
  | 'NOT_OWNED'
  | 'PRODUCT_UNAVAILABLE'
  | 'QUANTITY_OUT_OF_BOUNDS'
  | 'CART_LIMIT_EXCEEDED'
  | 'RETRYABLE_FAILURE';

export interface CartLine {
  productId: string;
  name: string;
  unitPriceUgx: number;
  quantity: number;
}

export interface CartView {
  id: string;
  version: number;
  items: CartLine[];
  subtotalUgx: number;
}

export type CartOutcome =
  | { kind: 'APPLIED'; cart: CartView }
  | { kind: 'VERSION_CONFLICT'; cart: CartView }
  | { kind: Exclude<CartOutcomeKind, 'APPLIED' | 'VERSION_CONFLICT'>; reason: string };

export function isCartApplied(outcome: CartOutcome): outcome is { kind: 'APPLIED'; cart: CartView } {
  return outcome.kind === 'APPLIED';
}

/**
 * Bounds. Enforced here AND by a database constraint (migration 0060): validation in
 * one route protects that route, a constraint protects the column from every writer.
 */
export const MAX_LINE_QUANTITY = 999;
export const MAX_DISTINCT_LINES = 50;

export interface CartOwner {
  kind: CartOwnerKind;
  id: string;
}

export interface CartRecord {
  id: string;
  version: number;
  ownerKind: CartOwnerKind | null;
  ownerId: string | null;
  items: CartLine[];
}

export interface ICartAuthorizedRepository {
  find(cartId: string): Promise<CartRecord | null>;
  /**
   * Claims an unowned cart for this owner, but only while it is still unowned.
   *
   * Conditional so two concurrent first-touches cannot both claim it. Returns false
   * when someone got there first, and the caller re-reads rather than assuming.
   */
  claimOwnership(cartId: string, owner: CartOwner): Promise<boolean>;
  /**
   * Applies the new item set at `expectedVersion`, bumping the version.
   *
   * Returns false when the version no longer matches — the cart changed under the
   * caller — and writes nothing. That is the whole point: the previous
   * delete-then-reinsert had no such check, so the last writer silently won.
   */
  replaceItems(args: {
    cartId: string;
    expectedVersion: number;
    items: Array<{ productId: string; quantity: number }>;
  }): Promise<boolean>;
}

export interface CartProductReader {
  /** Only products a customer may actually buy. Absent means not purchasable. */
  findPurchasable(productIds: readonly string[]): Promise<
    Array<{ id: string; name: string; unitPriceUgx: number }>
  >;
}

export interface MutateCartDeps {
  carts: ICartAuthorizedRepository;
  products: CartProductReader;
  observer?: {
    onOwnershipDenied(cartId: string, traceId: string): void;
    onVersionConflict(cartId: string, traceId: string): void;
  };
}

function view(record: CartRecord): CartView {
  return {
    id: record.id,
    version: record.version,
    items: record.items,
    subtotalUgx: record.items.reduce((sum, line) => sum + line.unitPriceUgx * line.quantity, 0),
  };
}

export class MutateCartUseCase {
  constructor(private readonly deps: MutateCartDeps) {}

  /**
   * Reads a cart the caller owns.
   *
   * Separate from mutation because the read route needs the same authorization and
   * previously had none at all.
   */
  async read(args: { cartId: string; owner: CartOwner; traceId: string }): Promise<CartOutcome> {
    const authorized = await this.authorize(args.cartId, args.owner, args.traceId);
    if ('refusal' in authorized) return authorized.refusal;
    return { kind: 'APPLIED', cart: view(authorized.record) };
  }

  async mutate(args: {
    cartId: string;
    owner: CartOwner;
    /** The version the caller believes it is changing. Omit only for a first write. */
    expectedVersion?: number;
    mutation: CartMutationKind;
    traceId: string;
  }): Promise<CartOutcome> {
    const authorized = await this.authorize(args.cartId, args.owner, args.traceId);
    if ('refusal' in authorized) return authorized.refusal;
    const record = authorized.record;

    // A caller that names a version must be holding the current one. Omitting the
    // version is allowed — the first write from a fresh page has not read the cart —
    // but naming a stale one is refused rather than applied over whatever is there.
    if (args.expectedVersion !== undefined && args.expectedVersion !== record.version) {
      this.deps.observer?.onVersionConflict(args.cartId, args.traceId);
      return { kind: 'VERSION_CONFLICT', cart: view(record) };
    }

    const next = this.applyMutation(record, args.mutation);
    if ('refusal' in next) return next.refusal;

    if (next.items.length > MAX_DISTINCT_LINES) {
      return { kind: 'CART_LIMIT_EXCEEDED', reason: 'TOO_MANY_DISTINCT_PRODUCTS' };
    }

    // Every product in the RESULTING cart is validated, not merely the one being
    // touched. A product withdrawn while it sat in the basket must not survive
    // because the customer happened to change a different line.
    const productIds = next.items.map((line) => line.productId);
    const purchasable = await this.deps.products.findPurchasable(productIds);
    const byId = new Map(purchasable.map((product) => [product.id, product]));

    const missing = productIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      // Named by id, which is public catalogue data, so the storefront can tell the
      // customer which line to remove instead of showing an opaque failure.
      return { kind: 'PRODUCT_UNAVAILABLE', reason: missing.join(',') };
    }

    const applied = await this.deps.carts.replaceItems({
      cartId: record.id,
      expectedVersion: record.version,
      items: next.items.map((line) => ({ productId: line.productId, quantity: line.quantity })),
    });

    if (!applied) {
      // Lost the race between the read and the write. Re-read so the caller is told
      // what the cart actually holds now rather than a stale picture of it.
      const current = await this.deps.carts.find(record.id);
      this.deps.observer?.onVersionConflict(args.cartId, args.traceId);
      return current
        ? { kind: 'VERSION_CONFLICT', cart: view(current) }
        : { kind: 'CART_NOT_FOUND', reason: 'CART_NOT_FOUND' };
    }

    const saved = await this.deps.carts.find(record.id);
    if (!saved) return { kind: 'RETRYABLE_FAILURE', reason: 'CART_UNREADABLE_AFTER_WRITE' };

    // Prices come from the catalogue read, never from the request.
    const priced: CartRecord = {
      ...saved,
      items: saved.items.map((line) => {
        const product = byId.get(line.productId);
        return product
          ? { ...line, name: product.name, unitPriceUgx: product.unitPriceUgx }
          : line;
      }),
    };
    return { kind: 'APPLIED', cart: view(priced) };
  }

  /**
   * Establishes that this owner may act on this cart.
   *
   * An UNOWNED cart is claimable: carts predating migration 0060 have no owner, and
   * refusing them would empty the basket of every shopper mid-session. The claim is
   * conditional, so the first credential to touch it becomes the owner and every
   * other one is refused from then on — which is strictly more protection than the
   * previous behaviour, where any caller could act on any cart forever.
   */
  private async authorize(
    cartId: string,
    owner: CartOwner,
    traceId: string,
  ): Promise<{ record: CartRecord } | { refusal: CartOutcome }> {
    const record = await this.deps.carts.find(cartId);
    if (!record) return { refusal: { kind: 'CART_NOT_FOUND', reason: 'CART_NOT_FOUND' } };

    if (record.ownerKind === null) {
      const claimed = await this.deps.carts.claimOwnership(cartId, owner);
      if (!claimed) {
        // Someone claimed it between the read and here. Re-read rather than assume.
        const current = await this.deps.carts.find(cartId);
        if (!current || current.ownerId !== owner.id || current.ownerKind !== owner.kind) {
          this.deps.observer?.onOwnershipDenied(cartId, traceId);
          return { refusal: { kind: 'NOT_OWNED', reason: 'CART_NOT_FOUND' } };
        }
        return { record: current };
      }
      return { record: { ...record, ownerKind: owner.kind, ownerId: owner.id } };
    }

    if (record.ownerKind !== owner.kind || record.ownerId !== owner.id) {
      this.deps.observer?.onOwnershipDenied(cartId, traceId);
      // Reported as CART_NOT_FOUND. "Exists but is not yours" and "does not exist"
      // must be indistinguishable, or the endpoint becomes a cart-id oracle.
      return { refusal: { kind: 'NOT_OWNED', reason: 'CART_NOT_FOUND' } };
    }

    return { record };
  }

  private applyMutation(
    record: CartRecord,
    mutation: CartMutationKind,
  ): { items: CartLine[] } | { refusal: CartOutcome } {
    const items = record.items.map((line) => ({ ...line }));

    switch (mutation.kind) {
      case 'CLEAR':
        return { items: [] };

      case 'REMOVE':
        return { items: items.filter((line) => line.productId !== mutation.productId) };

      case 'ADD': {
        const existing = items.find((line) => line.productId === mutation.productId);
        const total = (existing?.quantity ?? 0) + mutation.quantity;
        if (total < 1 || total > MAX_LINE_QUANTITY) {
          // Checked on the RESULT, not the increment. Adding 1 repeatedly must not
          // walk a line past the bound one request at a time.
          return { refusal: { kind: 'QUANTITY_OUT_OF_BOUNDS', reason: 'LINE_QUANTITY' } };
        }
        if (existing) {
          existing.quantity = total;
        } else {
          items.push({ productId: mutation.productId, name: '', unitPriceUgx: 0, quantity: total });
        }
        return { items };
      }

      case 'UPDATE': {
        // Zero is a removal, which is what the UI's "set to 0" means. Negative is
        // not: it is a malformed request, and silently treating it as a removal would
        // accept a payload the schema is meant to reject.
        if (mutation.quantity === 0) {
          return { items: items.filter((line) => line.productId !== mutation.productId) };
        }
        if (mutation.quantity < 0 || mutation.quantity > MAX_LINE_QUANTITY) {
          return { refusal: { kind: 'QUANTITY_OUT_OF_BOUNDS', reason: 'LINE_QUANTITY' } };
        }
        const existing = items.find((line) => line.productId === mutation.productId);
        if (!existing) {
          // Updating a line that is not in the cart is not an add: the caller is
          // working from a stale view of the basket.
          return { refusal: { kind: 'VERSION_CONFLICT', cart: view(record) } };
        }
        existing.quantity = mutation.quantity;
        return { items };
      }
    }
  }
}
