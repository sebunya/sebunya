import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MutateCartUseCase,
  isCartApplied,
  MAX_LINE_QUANTITY,
  MAX_DISTINCT_LINES,
  type CartOutcome,
  type CartOwner,
  type CartRecord,
  type MutateCartDeps,
} from '../../apps/api/src/application/use-cases/commerce/MutateCartUseCase';
import {
  buildCartKeyring,
  deriveCartKey,
  issueCartCredential,
  verifyCartCredential,
  MIN_CART_ROOT_SECRET_LENGTH,
  CART_CREDENTIAL_HEADER,
} from '../../packages/shared/src/cart-credential';

/**
 * Every cart route took a `cartId` straight from the request and acted on it with no
 * authorization of any kind: add items to any cart, change any quantity, empty any
 * cart, read any cart's contents. The id is a v4 UUID, so it is not guessable — but
 * the whole design rested on that secrecy, and the value travelled where a secret must
 * not: it was the browser's cookie, and on the read route a URL PATH SEGMENT, so it
 * reached access logs, proxy logs, browser history and Referer headers.
 *
 * These are behavioural tests through the ports: who is refused, what is written, and
 * what a concurrent writer sees.
 */

const OWNER: CartOwner = { kind: 'GUEST', id: 'guest-1' };
const OTHER: CartOwner = { kind: 'GUEST', id: 'guest-2' };
const USER: CartOwner = { kind: 'USER', id: 'user-1' };

const CART_ID = '11111111-1111-4111-8111-111111111111';
const P1 = '22222222-2222-4222-8222-222222222222';
const P2 = '33333333-3333-4333-8333-333333333333';

const record = (over: Partial<CartRecord> = {}): CartRecord => ({
  id: CART_ID,
  version: 3,
  ownerKind: 'GUEST',
  ownerId: 'guest-1',
  items: [{ productId: P1, name: 'One', unitPriceUgx: 1000, quantity: 2 }],
  ...over,
});

interface Trace {
  writes: Array<{ expectedVersion: number; items: Array<{ productId: string; quantity: number }> }>;
  claims: CartOwner[];
  denied: string[];
  conflicts: string[];
}

function build(opts: {
  cart?: CartRecord | null;
  /** Forces the version-checked write to report a lost race. */
  writeLoses?: boolean;
  /** Forces the conditional ownership claim to report a lost race. */
  claimLoses?: boolean;
  /** Products the catalogue will admit are purchasable. */
  purchasable?: string[];
  /** What a re-read returns after a lost race. */
  afterRace?: CartRecord | null;
} = {}) {
  const trace: Trace = { writes: [], claims: [], denied: [], conflicts: [] };
  let reads = 0;
  const cart = opts.cart === undefined ? record() : opts.cart;

  const deps: MutateCartDeps = {
    carts: {
      find: async () => {
        reads++;
        // The second read models what the row looks like AFTER losing a race.
        if (reads > 1 && opts.afterRace !== undefined) return opts.afterRace;
        return cart;
      },
      claimOwnership: async (_id, owner) => {
        trace.claims.push(owner);
        return !opts.claimLoses;
      },
      replaceItems: async (args) => {
        trace.writes.push({ expectedVersion: args.expectedVersion, items: args.items });
        return !opts.writeLoses;
      },
    },
    products: {
      findPurchasable: async (ids) => {
        const allowed = new Set(opts.purchasable ?? [P1, P2]);
        return ids
          .filter((id) => allowed.has(id))
          .map((id) => ({ id, name: id === P1 ? 'One' : 'Two', unitPriceUgx: id === P1 ? 1000 : 2500 }));
      },
    },
    observer: {
      onOwnershipDenied: (cartId) => trace.denied.push(cartId),
      onVersionConflict: (cartId) => trace.conflicts.push(cartId),
    },
  };

  return { useCase: new MutateCartUseCase(deps), trace };
}

const traceId = 'trace-1';

describe('a cart id is not authority over the cart', () => {
  it('refuses a different guest', async () => {
    const { useCase, trace } = build();
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OTHER, mutation: { kind: 'REMOVE', productId: P1 }, traceId,
    });

    expect(outcome.kind).toBe('NOT_OWNED');
    // Nothing was written. Detecting the denial and writing anyway is the failure the
    // check exists to prevent.
    expect(trace.writes).toEqual([]);
    expect(trace.denied).toEqual([CART_ID]);
  });

  it('refuses a different user', async () => {
    const { useCase, trace } = build({ cart: record({ ownerKind: 'USER', ownerId: 'user-1' }) });
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: { kind: 'USER', id: 'user-9' }, mutation: { kind: 'CLEAR' }, traceId,
    });
    expect(outcome.kind).toBe('NOT_OWNED');
    expect(trace.writes).toEqual([]);
  });

  it('refuses a guest reaching a user\'s cart', async () => {
    const { useCase } = build({ cart: record({ ownerKind: 'USER', ownerId: 'user-1' }) });
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, mutation: { kind: 'CLEAR' }, traceId,
    });
    expect(outcome.kind).toBe('NOT_OWNED');
  });

  it('refuses a user reaching a guest\'s cart', async () => {
    const { useCase } = build();
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: USER, mutation: { kind: 'CLEAR' }, traceId,
    });
    expect(outcome.kind).toBe('NOT_OWNED');
  });

  it('refuses a READ from a non-owner, not only a write', async () => {
    // The read route disclosed basket contents to anyone with the id.
    const { useCase } = build();
    const outcome = await useCase.read({ cartId: CART_ID, owner: OTHER, traceId });
    expect(outcome.kind).toBe('NOT_OWNED');
    expect(isCartApplied(outcome)).toBe(false);
  });

  it('reports a foreign cart as NOT_FOUND, indistinguishable from a missing one', async () => {
    // Otherwise the endpoint is a cart-id oracle: a probe learns which ids are real.
    const { useCase } = build();
    const foreign = await useCase.read({ cartId: CART_ID, owner: OTHER, traceId });
    const { useCase: missing } = build({ cart: null });
    const absent = await missing.read({ cartId: CART_ID, owner: OWNER, traceId });

    expect('reason' in foreign && foreign.reason).toBe('CART_NOT_FOUND');
    expect('reason' in absent && absent.reason).toBe('CART_NOT_FOUND');
  });
});

describe('the owner may act on their own cart', () => {
  it('applies an add and returns the priced basket', async () => {
    const { useCase, trace } = build();
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, mutation: { kind: 'ADD', productId: P2, quantity: 1 }, traceId,
    });

    expect(outcome.kind).toBe('APPLIED');
    expect(trace.writes[0].items).toEqual([
      { productId: P1, quantity: 2 },
      { productId: P2, quantity: 1 },
    ]);
  });

  it('writes at the version it actually read', async () => {
    // The version in the WHERE clause is the whole concurrency guarantee.
    const { useCase, trace } = build();
    await useCase.mutate({ cartId: CART_ID, owner: OWNER, mutation: { kind: 'CLEAR' }, traceId });
    expect(trace.writes[0].expectedVersion).toBe(3);
  });

  it('prices lines from the catalogue, never from the request', async () => {
    const { useCase } = build();
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, mutation: { kind: 'ADD', productId: P2, quantity: 2 }, traceId,
    });
    expect(isCartApplied(outcome) && outcome.cart.items.every((line) => line.unitPriceUgx > 0)).toBe(true);
  });
});

describe('an unowned cart is claimed once, then protected', () => {
  it('claims a legacy cart for the first credential that presents it', async () => {
    // Carts predating migration 0060 have no owner and cannot be attributed
    // retroactively. Refusing them would empty every shopper's basket mid-session.
    const { useCase, trace } = build({ cart: record({ ownerKind: null, ownerId: null }) });
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, mutation: { kind: 'CLEAR' }, traceId,
    });
    expect(outcome.kind).toBe('APPLIED');
    expect(trace.claims).toEqual([OWNER]);
  });

  it('refuses a second principal once the claim is lost', async () => {
    // The claim is conditional, so a concurrent first-touch cannot also win.
    const { useCase, trace } = build({
      cart: record({ ownerKind: null, ownerId: null }),
      claimLoses: true,
      afterRace: record({ ownerKind: 'GUEST', ownerId: 'guest-2' }),
    });
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, mutation: { kind: 'CLEAR' }, traceId,
    });
    expect(outcome.kind).toBe('NOT_OWNED');
    expect(trace.writes).toEqual([]);
  });

  it('proceeds when the lost claim turns out to have been its own', async () => {
    // Two requests from the SAME browser can race. The loser must not be refused its
    // own cart.
    const { useCase } = build({
      cart: record({ ownerKind: null, ownerId: null }),
      claimLoses: true,
      afterRace: record({ ownerKind: 'GUEST', ownerId: 'guest-1' }),
    });
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, mutation: { kind: 'CLEAR' }, traceId,
    });
    expect(outcome.kind).toBe('APPLIED');
  });
});

describe('concurrent writers cannot silently overwrite each other', () => {
  it('refuses a caller holding a stale version', async () => {
    const { useCase, trace } = build();
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, expectedVersion: 2, mutation: { kind: 'CLEAR' }, traceId,
    });
    expect(outcome.kind).toBe('VERSION_CONFLICT');
    expect(trace.writes).toEqual([]);
  });

  it('returns the CURRENT basket with the conflict', async () => {
    // A conflict with no state leaves the page showing what the customer thought was
    // there. The refreshed basket is what makes the retry meaningful.
    const { useCase } = build();
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, expectedVersion: 2, mutation: { kind: 'CLEAR' }, traceId,
    });
    expect(outcome.kind === 'VERSION_CONFLICT' && outcome.cart.version).toBe(3);
  });

  it('reports a lost write race rather than retrying blindly', async () => {
    // This is the REMOVE-undone-by-UPDATE case: the previous repository deleted and
    // reinserted with no version check, so the last writer silently won and an item
    // the customer deleted came back.
    const { useCase, trace } = build({
      writeLoses: true,
      afterRace: record({ version: 4 }),
    });
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, mutation: { kind: 'REMOVE', productId: P1 }, traceId,
    });
    expect(outcome.kind).toBe('VERSION_CONFLICT');
    expect(trace.conflicts).toEqual([CART_ID]);
  });

  it('allows a first write with no version, since a fresh page has read nothing', async () => {
    const { useCase, trace } = build();
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, mutation: { kind: 'ADD', productId: P2, quantity: 1 }, traceId,
    });
    expect(outcome.kind).toBe('APPLIED');
    expect(trace.writes).toHaveLength(1);
  });
});

describe('only purchasable products may sit in a cart', () => {
  it('refuses a product the catalogue will not sell', async () => {
    const { useCase, trace } = build({ purchasable: [P1] });
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, mutation: { kind: 'ADD', productId: P2, quantity: 1 }, traceId,
    });
    expect(outcome.kind).toBe('PRODUCT_UNAVAILABLE');
    expect(trace.writes).toEqual([]);
  });

  it('validates the whole resulting basket, not only the line being touched', async () => {
    // A product withdrawn while it sat in the basket must not survive because the
    // customer happened to change a different line.
    const { useCase } = build({
      cart: record({ items: [{ productId: P2, name: 'Two', unitPriceUgx: 2500, quantity: 1 }] }),
      purchasable: [P1],
    });
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, mutation: { kind: 'ADD', productId: P1, quantity: 1 }, traceId,
    });
    expect(outcome.kind).toBe('PRODUCT_UNAVAILABLE');
  });

  it('names the offending product ids so the page can tell the customer which line', async () => {
    // Product ids are public catalogue data; the alternative is an opaque failure that
    // leaves the customer to guess which item to remove.
    const { useCase } = build({ purchasable: [P1] });
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, mutation: { kind: 'ADD', productId: P2, quantity: 1 }, traceId,
    });
    expect(outcome.kind).toBe('PRODUCT_UNAVAILABLE');
    expect('reason' in outcome && outcome.reason.split(',')).toEqual([P2]);
  });

  it('allows a CLEAR even when the basket holds an unavailable product', async () => {
    // Otherwise a withdrawn product wedges the basket permanently: the customer cannot
    // buy it and cannot get rid of it either.
    const { useCase } = build({
      cart: record({ items: [{ productId: P2, name: 'Two', unitPriceUgx: 2500, quantity: 1 }] }),
      purchasable: [],
    });
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, mutation: { kind: 'CLEAR' }, traceId,
    });
    expect(outcome.kind).toBe('APPLIED');
  });

  it('allows a REMOVE of the unavailable product itself', async () => {
    const { useCase } = build({
      cart: record({
        items: [
          { productId: P1, name: 'One', unitPriceUgx: 1000, quantity: 1 },
          { productId: P2, name: 'Two', unitPriceUgx: 2500, quantity: 1 },
        ],
      }),
      purchasable: [P1],
    });
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, mutation: { kind: 'REMOVE', productId: P2 }, traceId,
    });
    expect(outcome.kind).toBe('APPLIED');
  });
});

describe('quantities and basket size are bounded', () => {
  it('refuses a line beyond the maximum', async () => {
    const { useCase } = build();
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER,
      mutation: { kind: 'UPDATE', productId: P1, quantity: MAX_LINE_QUANTITY + 1 },
      traceId,
    });
    expect(outcome.kind).toBe('QUANTITY_OUT_OF_BOUNDS');
  });

  it('checks the RESULT of an add, not the increment', async () => {
    // Adding one repeatedly must not walk a line past the bound one request at a time.
    const { useCase } = build({
      cart: record({ items: [{ productId: P1, name: 'One', unitPriceUgx: 1000, quantity: MAX_LINE_QUANTITY }] }),
    });
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, mutation: { kind: 'ADD', productId: P1, quantity: 1 }, traceId,
    });
    expect(outcome.kind).toBe('QUANTITY_OUT_OF_BOUNDS');
  });

  it('treats an update to zero as a removal', async () => {
    const { useCase, trace } = build();
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, mutation: { kind: 'UPDATE', productId: P1, quantity: 0 }, traceId,
    });
    expect(outcome.kind).toBe('APPLIED');
    expect(trace.writes[0].items).toEqual([]);
  });

  it('refuses a negative quantity rather than reading it as a removal', async () => {
    const { useCase, trace } = build();
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, mutation: { kind: 'UPDATE', productId: P1, quantity: -5 }, traceId,
    });
    expect(outcome.kind).toBe('QUANTITY_OUT_OF_BOUNDS');
    expect(trace.writes).toEqual([]);
  });

  it('refuses a basket with too many distinct products', async () => {
    const many = Array.from({ length: MAX_DISTINCT_LINES }, (_, i) => ({
      productId: `4${String(i).padStart(7, '0')}-4444-4444-8444-444444444444`,
      name: 'x', unitPriceUgx: 1, quantity: 1,
    }));
    const { useCase } = build({ cart: record({ items: many }) });
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, mutation: { kind: 'ADD', productId: P1, quantity: 1 }, traceId,
    });
    expect(outcome.kind).toBe('CART_LIMIT_EXCEEDED');
  });

  it('treats an update to a line not in the basket as a stale view', async () => {
    // Silently adding it would turn a stale UPDATE into an unintended ADD.
    const { useCase } = build();
    const outcome = await useCase.mutate({
      cartId: CART_ID, owner: OWNER, mutation: { kind: 'UPDATE', productId: P2, quantity: 1 }, traceId,
    });
    expect(outcome.kind).toBe('VERSION_CONFLICT');
  });
});

describe('the cart credential is signed and owner-bound', () => {
  const root = 'c'.repeat(MIN_CART_ROOT_SECRET_LENGTH);
  const key = deriveCartKey(root, '1');

  it('verifies a credential it issued', () => {
    const issued = issueCartCredential({ key, cartId: CART_ID, ownerKind: 'GUEST', ownerId: 'g1' });
    const verified = verifyCartCredential([key], issued.token);
    expect(verified.valid).toBe(true);
    expect(verified.valid && verified.claims.cartId).toBe(CART_ID);
  });

  it('rejects a tampered cart id', () => {
    // This is the whole point: the id is inside the signature, so swapping it invalidates
    // the credential rather than redirecting it at another basket.
    const issued = issueCartCredential({ key, cartId: CART_ID, ownerKind: 'GUEST', ownerId: 'g1' });
    const [version, claims, mac] = issued.token.split('.');
    const forged = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8'));
    forged.cartId = '99999999-9999-4999-8999-999999999999';
    const tampered = `${version}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${mac}`;
    expect(verifyCartCredential([key], tampered)).toEqual({ valid: false, reason: 'BAD_SIGNATURE' });
  });

  it('rejects a credential signed with an unrelated key', () => {
    const other = deriveCartKey('d'.repeat(MIN_CART_ROOT_SECRET_LENGTH), '1');
    const issued = issueCartCredential({ key: other, cartId: CART_ID, ownerKind: 'GUEST', ownerId: 'g1' });
    expect(verifyCartCredential([key], issued.token).valid).toBe(false);
  });

  it('is not interchangeable with a checkout intent', async () => {
    // Both are HMACs over base64url claims from the same root secret. A shared key
    // would let one be presented as the other; the KDF label is what prevents it.
    const { deriveIntentKey } = await import('../../packages/shared/src/checkout-intent');
    expect(deriveCartKey(root, '1').secret).not.toBe(deriveIntentKey(root, '1').secret);
  });

  it('rejects an expired credential', () => {
    const issued = issueCartCredential({
      key, cartId: CART_ID, ownerKind: 'GUEST', ownerId: 'g1',
      now: new Date('2020-01-01T00:00:00Z'), ttlSeconds: 60,
    });
    expect(verifyCartCredential([key], issued.token)).toEqual({ valid: false, reason: 'EXPIRED' });
  });

  it('reports a forgery as a forgery even when it is also expired', () => {
    // Checking expiry first would tell a caller their fabricated token was
    // structurally acceptable.
    const issued = issueCartCredential({
      key, cartId: CART_ID, ownerKind: 'GUEST', ownerId: 'g1',
      now: new Date('2020-01-01T00:00:00Z'), ttlSeconds: 60,
    });
    const broken = `${issued.token.slice(0, -4)}AAAA`;
    expect(verifyCartCredential([key], broken).valid).toBe(false);
    expect(verifyCartCredential([key], broken)).not.toEqual({ valid: false, reason: 'EXPIRED' });
  });

  it('refuses a root secret too short to be safe', () => {
    expect(() => deriveCartKey('short', '1')).toThrow('CART_CREDENTIAL_SECRET_TOO_SHORT');
  });

  it('accepts a previous-key credential during a rotation', () => {
    const old = deriveCartKey(root, '1');
    const issued = issueCartCredential({ key: old, cartId: CART_ID, ownerKind: 'GUEST', ownerId: 'g1' });
    const ring = buildCartKeyring({ rootSecret: root, currentKeyId: '2', previousKeyId: '1' });
    expect(verifyCartCredential(ring, issued.token).valid).toBe(true);
  });
});

describe('the cart routes are thin and take no cart id from the caller', () => {
  const source = readFileSync(
    join(__dirname, '../../apps/api/src/interfaces/http/routes/commerce.ts'),
    'utf8',
  );
  const cartSection = source.slice(
    source.indexOf('// Cart\n'),
    source.indexOf("routes.post('/orders/create'"),
  );
  const code = cartSection.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('never reads a cart id from the request body or path', () => {
    // This is the defect. The id now comes only from the verified credential.
    expect(code).not.toMatch(/body\.cartId/);
    expect(code).not.toMatch(/param\('id'\)/);
    expect(code).toContain('gate.claims.cartId');
  });

  it('requires a verified credential on every cart route', () => {
    const handlers = code.match(/routes\.(get|post)\('\/cart/g) ?? [];
    const gates = code.match(/await requireCart\(c\)/g) ?? [];
    expect(handlers.length).toBeGreaterThanOrEqual(5);
    // One gate per handler. A route added without one is the original failure.
    expect(gates.length).toBe(handlers.length);
  });

  it('resolves the session before the credential, so a USER cart can be cross-checked', () => {
    const gate = code.slice(code.indexOf('async function requireCart'));
    const sessionAt = gate.indexOf('applyOptionalCustomerSession');
    const resolveAt = gate.indexOf('resolveCartCredential');
    expect(sessionAt).toBeGreaterThan(-1);
    expect(resolveAt).toBeGreaterThan(sessionAt);
  });

  it('never returns an internal error message', () => {
    expect(code).not.toContain('err.message');
    expect(code).not.toContain('error.message');
    expect(code).not.toContain('console.error');
  });

  it('no longer exposes a cart id in a URL path', () => {
    expect(source).not.toContain("routes.get('/carts/:id'");
  });

  it('forwards the credential in a header, not a query string', () => {
    // A query string lands in access logs and Referer headers, which is what the path
    // segment did.
    expect(CART_CREDENTIAL_HEADER.startsWith('x-')).toBe(true);
    expect(code).not.toMatch(/query\(['"]cart/);
  });
});

describe('the storefront refuses cross-site basket mutations before it mints', () => {
  const page = readFileSync(join(__dirname, '../../apps/web/src/pages/cart.astro'), 'utf8');
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('checks the origin before resolving the credential', () => {
    // Resolving MINTS. Checking afterwards would still hand a cross-site request a
    // freshly issued basket identity.
    const originAt = code.indexOf('checkRequestOrigin(');
    const resolveAt = code.indexOf('resolveCartCredential(Astro.cookies');
    expect(originAt).toBeGreaterThan(-1);
    expect(resolveAt).toBeGreaterThan(originAt);
  });

  it('does not run the mutation branch for a refused request', () => {
    expect(code).toMatch(/method === 'POST' && cartOrigin\.allowed/);
  });

  it('surfaces a refused server write instead of updating silently', () => {
    // The previous page discarded every response and warned to the console while
    // updating the local cookie regardless, so a rejected write looked accepted.
    expect(code).toContain('cartNotice = cartMessageFor(result.code)');
    expect(code).toMatch(/\{cartNotice &&/);
  });
});
