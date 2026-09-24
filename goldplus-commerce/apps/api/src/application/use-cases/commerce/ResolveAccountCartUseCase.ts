import {
  MAX_DISTINCT_LINES,
  MAX_LINE_QUANTITY,
  type CartOwner,
  type CartProductReader,
  type ICartAuthorizedRepository,
} from './MutateCartUseCase';

/**
 * Which basket a signed-in customer's new cart credential should name, and the
 * guest basket they brought with them folded into it.
 *
 * WHAT WAS WRONG
 * The storefront minted a brand-new random cart id every time a signed-in
 * customer needed a USER credential: on sign-in, on a fresh device, after a
 * lapsed session. The API finds a cart only by the id inside the credential, so
 * the customer's earlier basket was never found again, and a guest who signed in
 * at checkout ("sign in to earn points") watched their basket empty — the lines
 * survived only in a device cookie, at stale prices, until the first add hid
 * them behind a one-item server cart.
 *
 * Now the storefront asks here before minting. The answer is the customer's
 * newest unexpired basket (or a fresh id when they have none), with any verified
 * guest basket's purchasable lines merged in atomically: the guest basket is
 * emptied in the same transaction, so a retry or a second tab cannot add the same
 * lines twice.
 */

export interface IAccountCartRepository {
  /** The newest unexpired cart owned by `owner`, or null. */
  findLatestFor(owner: CartOwner, now: Date): Promise<{ id: string } | null>;
  /**
   * In one transaction: empties the guest cart at `guestVersion`, and writes
   * `items` to the target cart at `targetExpectedVersion` (creating it, owned by
   * `targetOwner`, when that is null). False, with nothing written, when either
   * version moved or the target appeared meanwhile.
   */
  mergeInto(args: {
    guestCartId: string;
    guestVersion: number;
    targetCartId: string;
    targetOwner: CartOwner;
    targetExpectedVersion: number | null;
    items: Array<{ productId: string; quantity: number }>;
  }): Promise<boolean>;
}

export interface ResolveAccountCartDeps {
  carts: ICartAuthorizedRepository;
  accounts: IAccountCartRepository;
  products: CartProductReader;
  newCartId?: () => string;
  now?: () => Date;
}

export interface ResolveAccountCartResult {
  cartId: string;
  /** Guest lines folded into the account basket by this call. */
  mergedLines: number;
}

export class ResolveAccountCartUseCase {
  constructor(private readonly deps: ResolveAccountCartDeps) {}

  async execute(args: {
    userId: string;
    /** From a guest credential the API has already VERIFIED. Never from the request body. */
    guest?: { cartId: string; ownerId: string } | null;
  }): Promise<ResolveAccountCartResult> {
    const owner: CartOwner = { kind: 'USER', id: args.userId };
    // Two attempts: a lost race re-reads both baskets once rather than giving up
    // on the first concurrent write.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const outcome = await this.attempt(owner, args.guest ?? null);
      if (outcome) return outcome;
    }
    const latest = await this.deps.accounts.findLatestFor(owner, this.now());
    return { cartId: latest?.id ?? this.newId(), mergedLines: 0 };
  }

  private async attempt(
    owner: CartOwner,
    guest: { cartId: string; ownerId: string } | null,
  ): Promise<ResolveAccountCartResult | null> {
    const latest = await this.deps.accounts.findLatestFor(owner, this.now());
    const targetCartId = latest?.id ?? this.newId();
    if (!guest || guest.cartId === targetCartId) return { cartId: targetCartId, mergedLines: 0 };

    const guestRecord = await this.deps.carts.find(guest.cartId);
    // Only a basket the verified guest credential actually owns is adopted. An
    // unowned or differently-owned cart is left exactly where it is.
    if (
      !guestRecord ||
      guestRecord.ownerKind !== 'GUEST' ||
      guestRecord.ownerId !== guest.ownerId ||
      guestRecord.items.length === 0
    ) {
      return { cartId: targetCartId, mergedLines: 0 };
    }

    const target = latest ? await this.deps.carts.find(targetCartId) : null;
    if (target && (target.ownerKind !== owner.kind || target.ownerId !== owner.id)) {
      return { cartId: this.newId(), mergedLines: 0 };
    }

    // Withdrawn products are not carried over: a merge must not smuggle into the
    // account basket a line a direct add would refuse.
    const purchasable = new Set(
      (await this.deps.products.findPurchasable(guestRecord.items.map((line) => line.productId))).map(
        (product) => product.id,
      ),
    );

    const merged = new Map<string, number>();
    for (const line of target?.items ?? []) merged.set(line.productId, line.quantity);
    let mergedLines = 0;
    for (const line of guestRecord.items) {
      if (!purchasable.has(line.productId)) continue;
      const existing = merged.get(line.productId);
      if (existing === undefined && merged.size >= MAX_DISTINCT_LINES) continue;
      merged.set(line.productId, Math.min(MAX_LINE_QUANTITY, (existing ?? 0) + line.quantity));
      mergedLines += 1;
    }
    if (mergedLines === 0) return { cartId: targetCartId, mergedLines: 0 };

    const applied = await this.deps.accounts.mergeInto({
      guestCartId: guestRecord.id,
      guestVersion: guestRecord.version,
      targetCartId,
      targetOwner: owner,
      targetExpectedVersion: target ? target.version : null,
      items: [...merged].map(([productId, quantity]) => ({ productId, quantity })),
    });
    return applied ? { cartId: targetCartId, mergedLines } : null;
  }

  private newId(): string {
    return this.deps.newCartId ? this.deps.newCartId() : globalThis.crypto.randomUUID();
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }
}
