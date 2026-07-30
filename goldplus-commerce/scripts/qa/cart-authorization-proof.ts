/**
 * Real-PostgreSQL proof for cart ownership and optimistic concurrency.
 *
 * Runs the ACTUAL DrizzleAuthorizedCartRepository against a real PostgreSQL with
 * migration 0060 applied. None of these guarantees can be shown with a mock — each one
 * is a WHERE clause, a unique index or a transaction boundary:
 *
 *   - a conditional ownership claim: two concurrent first-touches, ONE owner
 *   - a version-checked write: the stale writer writes nothing at all
 *   - the version bump and the item rewrite commit together
 *   - a failed version check leaves the basket INTACT (the previous code deleted the
 *     items before discovering any problem, so a failure destroyed the basket)
 *   - one row per (cart, product), enforced by the database
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx scripts/qa/cart-authorization-proof.ts
 *
 * Read-write against the target database, so point it at a scratch one.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, client } from '../../apps/api/src/infrastructure/db/client';
import { carts, cartItems } from '../../apps/api/src/infrastructure/db/schema/commerce';
import { categories, products } from '../../apps/api/src/infrastructure/db/schema/products';
import { DrizzleAuthorizedCartRepository } from '../../apps/api/src/infrastructure/db/repositories/DrizzleAuthorizedCartRepository';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`),
  );
}

async function seedProduct(name: string): Promise<string> {
  const categoryId = randomUUID();
  await db.insert(categories).values({
    id: categoryId,
    name: `Cart Proof ${categoryId.slice(0, 8)}`,
    slug: `cart-proof-${categoryId.slice(0, 8)}`,
  });
  const productId = randomUUID();
  await db.insert(products).values({
    id: productId,
    sku: `CART-${productId.slice(0, 8)}`,
    modelNumber: 'CART-PROOF',
    name,
    slug: `cart-proof-${productId.slice(0, 8)}`,
    categoryId,
    priceUgx: 5000,
    stockQuantity: 10,
    active: true,
    approvalStatus: 'approved',
  });
  return productId;
}

async function main(): Promise<void> {
  const repo = new DrizzleAuthorizedCartRepository();
  const productA = await seedProduct('Cart Proof A');
  const productB = await seedProduct('Cart Proof B');

  // -- 1. Conditional ownership claim ---------------------------------------
  // An unowned cart (the state migration 0060 had to tolerate for historical rows) is
  // claimable by the first credential to present it, and by nobody afterwards.
  const cartId = randomUUID();
  await db.insert(carts).values({ id: cartId, version: 1 });

  const ownerA = { kind: 'GUEST' as const, id: `guest-${randomUUID()}` };
  const ownerB = { kind: 'GUEST' as const, id: `guest-${randomUUID()}` };

  // Concurrent, not sequential: a read-then-write would let both believe they own it,
  // and both would then pass every later ownership check.
  const claims = await Promise.all([
    repo.claimOwnership(cartId, ownerA),
    repo.claimOwnership(cartId, ownerB),
  ]);
  check('exactly one concurrent claim wins', claims.filter(Boolean).length, 1);

  const claimed = await repo.find(cartId);
  const winner = claimed?.ownerId === ownerA.id ? ownerA : ownerB;
  check('the row records the winner', claimed?.ownerId, winner.id);
  check('and its owner kind', claimed?.ownerKind, 'GUEST');

  const loserRetry = await repo.claimOwnership(cartId, claimed?.ownerId === ownerA.id ? ownerB : ownerA);
  check('the loser cannot claim it later either', loserRetry, false);

  // -- 2. Version-checked write ---------------------------------------------
  const first = await repo.replaceItems({
    cartId,
    expectedVersion: 1,
    items: [{ productId: productA, quantity: 2 }],
  });
  check('a write at the current version applies', first, true);

  const afterFirst = await repo.find(cartId);
  check('the version advanced', afterFirst?.version, 2);
  check('the item landed', afterFirst?.items.length, 1);
  check('with the right quantity', afterFirst?.items[0].quantity, 2);
  // Priced from product_prices, falling back to the product row. Either way it must not
  // be zero: the previous repository wrote `price: 0` into the domain object, so no
  // cart subtotal could match the order.
  check('the line is priced', (afterFirst?.items[0].unitPriceUgx ?? 0) > 0, true);

  const stale = await repo.replaceItems({
    cartId,
    expectedVersion: 1,
    items: [{ productId: productB, quantity: 5 }],
  });
  check('a write at a stale version is refused', stale, false);

  // THE critical assertion. The previous code deleted every item row before
  // discovering a problem, so a failed write emptied the basket.
  const afterStale = await repo.find(cartId);
  check('the refused write left the basket INTACT', afterStale?.items.length, 1);
  check('and did not touch the version', afterStale?.version, 2);
  check('and did not swap the product', afterStale?.items[0].productId, productA);

  // -- 3. Concurrent writers -------------------------------------------------
  // The REMOVE-undone-by-UPDATE case: two tabs acting on one basket at the same
  // version. Exactly one may win, and the loser must be told.
  const races = await Promise.all([
    repo.replaceItems({ cartId, expectedVersion: 2, items: [] }),
    repo.replaceItems({ cartId, expectedVersion: 2, items: [{ productId: productB, quantity: 1 }] }),
  ]);
  check('exactly one concurrent write wins', races.filter(Boolean).length, 1);

  const afterRace = await repo.find(cartId);
  check('the version advanced exactly once', afterRace?.version, 3);
  // Whichever won, the basket reflects ONE of the two intentions, never a blend.
  const coherent =
    afterRace?.items.length === 0 ||
    (afterRace?.items.length === 1 && afterRace.items[0].productId === productB);
  check('the basket reflects one intention, not a blend', coherent, true);

  // -- 4. One row per (cart, product) ---------------------------------------
  await repo.replaceItems({
    cartId,
    expectedVersion: afterRace?.version ?? 3,
    items: [{ productId: productA, quantity: 1 }],
  });
  let duplicateRejected = false;
  try {
    // Straight at the table, bypassing the repository: the guarantee must belong to the
    // database, not to the code path that happens to be in use.
    await db.insert(cartItems).values({ cartId, productId: productA, quantity: 9 });
  } catch {
    duplicateRejected = true;
  }
  check('the database refuses a duplicate line', duplicateRejected, true);

  // -- 5. Quantity bounds belong to the column ------------------------------
  let zeroRejected = false;
  try {
    await db.insert(cartItems).values({ cartId, productId: productB, quantity: 0 });
  } catch {
    zeroRejected = true;
  }
  check('the database refuses a zero quantity', zeroRejected, true);

  let hugeRejected = false;
  try {
    await db.insert(cartItems).values({ cartId, productId: productB, quantity: 1000 });
  } catch {
    hugeRejected = true;
  }
  check('the database refuses an out-of-range quantity', hugeRejected, true);

  // -- 6. An owned cart cannot be re-owned ---------------------------------
  const takeover = await repo.claimOwnership(cartId, { kind: 'USER', id: randomUUID() });
  check('an owned cart cannot be taken over', takeover, false);

  // -- 7. Ownership completeness is enforced by the database ---------------
  let halfOwnerRejected = false;
  try {
    await db.insert(carts).values({ id: randomUUID(), ownerKind: 'GUEST', version: 1 });
  } catch {
    halfOwnerRejected = true;
  }
  // A kind with no id is not a weaker authorization record; it is an unanswerable one.
  check('a cart cannot name a kind with no owner id', halfOwnerRejected, true);

  let badKindRejected = false;
  try {
    await db.insert(carts).values({ id: randomUUID(), ownerKind: 'ADMIN', ownerId: 'x', version: 1 });
  } catch {
    badKindRejected = true;
  }
  check('an unknown owner kind is refused', badKindRejected, true);

  // -- 8. Creation is always owned -----------------------------------------
  const freshId = randomUUID();
  const freshOwner = { kind: 'USER' as const, id: randomUUID() };
  await repo.create(freshId, freshOwner);
  const fresh = await repo.find(freshId);
  check('a created cart is owned from the start', fresh?.ownerId, freshOwner.id);
  check('and starts at version 1', fresh?.version, 1);
  // A bounded lifetime, so an abandoned basket is reclaimable rather than eternal.
  const [freshRow] = await db
    .select({ expiresAt: carts.expiresAt })
    .from(carts)
    .where(eq(carts.id, freshId));
  check('and carries an expiry', freshRow.expiresAt !== null, true);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
}

main()
  .then(async () => {
    await client.end({ timeout: 5 });
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    console.error('PROOF ABORTED:', error);
    await client.end({ timeout: 5 }).catch(() => undefined);
    process.exit(2);
  });
