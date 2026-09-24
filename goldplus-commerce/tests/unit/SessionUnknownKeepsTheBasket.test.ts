import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  buildCartKeyring,
  cartCredentialCookieName,
  issueCartCredential,
  verifyCartCredential,
} from '@goldplus/shared';
import {
  checkCustomerSession,
  classifySessionResponse,
  requestSession,
} from '../../apps/web/src/lib/customerAuth';
import { resolveCartCredential } from '../../apps/web/src/lib/cartCredential';
import { resolveRequestIdentity } from '../../apps/web/src/lib/requestIdentity';
import {
  ResolveAccountCartUseCase,
  type IAccountCartRepository,
} from '../../apps/api/src/application/use-cases/commerce/ResolveAccountCartUseCase';
import {
  MAX_LINE_QUANTITY,
  type CartRecord,
  type ICartAuthorizedRepository,
} from '../../apps/api/src/application/use-cases/commerce/MutateCartUseCase';

/**
 * A slow /account/me used to be read as "guest": the middleware replaced a signed-in
 * customer's USER cart credential with a GUEST one, the next page minted a new empty
 * USER cart, and the basket was gone. Checkout placed the order as a guest. And a
 * guest who signed in at checkout lost their basket because nothing merged it.
 */

const SECRET = 'unit-test-cart-secret-0123456789abcdef0123456789';
const COOKIE = cartCredentialCookieName(false);

beforeAll(() => {
  process.env.CART_CREDENTIAL_SECRET = SECRET;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jar(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  const sets: string[] = [];
  return {
    sets,
    get: (name: string) => (values.has(name) ? { value: values.get(name)! } : undefined),
    set: (name: string, value: string) => {
      sets.push(name);
      values.set(name, value);
    },
    delete: (name: string) => values.delete(name),
  };
}

function credential(ownerKind: 'USER' | 'GUEST', ownerId: string, cartId: string) {
  const [key] = buildCartKeyring({ rootSecret: SECRET });
  return issueCartCredential({ key, cartId, ownerKind, ownerId }).token;
}

function claimsOf(token: string) {
  const verified = verifyCartCredential(buildCartKeyring({ rootSecret: SECRET }), token);
  if (!verified.valid) throw new Error('invalid');
  return verified.claims;
}

const USER_CART = '11111111-1111-4111-8111-111111111111';
const GUEST_CART = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_CART = '33333333-3333-4333-8333-333333333333';

describe('the session check has three answers', () => {
  it('only a definite refusal is GUEST', () => {
    expect(classifySessionResponse(401, null)).toBe('GUEST');
    expect(classifySessionResponse(403, null)).toBe('GUEST');
    expect(classifySessionResponse(404, null)).toBe('GUEST');
    expect(classifySessionResponse(200, { success: true, data: { id: 'u-1' } })).toBe('USER');
    expect(classifySessionResponse(502, null)).toBe('UNKNOWN');
    expect(classifySessionResponse(429, null)).toBe('UNKNOWN');
    expect(classifySessionResponse(200, null)).toBe('UNKNOWN');
  });

  it('a timeout is UNKNOWN, not guest', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }));
    expect(await checkCustomerSession(jar({ goldplus_session: 'tok' }) as never)).toEqual({ state: 'UNKNOWN' });
  });

  it('no session cookie is GUEST without asking', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(await checkCustomerSession(jar({}) as never)).toEqual({ state: 'GUEST' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('pages re-ask when the middleware could not answer, and keep UNKNOWN distinct', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    expect(await requestSession({}, jar({ goldplus_session: 'tok' }) as never)).toEqual({ state: 'UNKNOWN' });
    expect(await requestSession({ gpUserId: 'u-9' }, jar({}) as never)).toEqual({ state: 'USER', userId: 'u-9' });
    expect(await requestSession({ gpUserId: null }, jar({}) as never)).toEqual({ state: 'GUEST' });
  });
});

describe('an UNKNOWN session never replaces the basket credential', () => {
  it('reuses a signed-in customer\'s USER credential and sets no cookie', async () => {
    const token = credential('USER', 'u-1', USER_CART);
    const cookies = jar({ goldplus_session: 'tok', [COOKIE]: token });
    const identity = await resolveRequestIdentity(cookies as never, {
      check: async () => ({ state: 'UNKNOWN' }),
    });
    expect(identity.gpUserId).toBeUndefined();
    expect(identity.gpSessionUnknown).toBe(true);
    expect(identity.gpCart?.token).toBe(token);
    expect(identity.gpCart?.cartId).toBe(USER_CART);
    expect(cookies.sets).toEqual([]);
  });

  it('mints nothing when there is no credential to reuse', () => {
    const cookies = jar({});
    expect(resolveCartCredential(cookies as never, null, { sessionUnknown: true })).toBeNull();
    expect(cookies.sets).toEqual([]);
  });

  it('the old two-way behaviour would have replaced it (guards the regression)', () => {
    const token = credential('USER', 'u-1', USER_CART);
    const cookies = jar({ [COOKIE]: token });
    const replaced = resolveCartCredential(cookies as never, null);
    expect(replaced?.fresh).toBe(true);
    expect(claimsOf(replaced!.token).ownerKind).toBe('GUEST');
  });

  it('checkout refuses to place or mint on UNKNOWN; cart reuses', () => {
    const root = resolve(__dirname, '../..');
    const checkout = readFileSync(resolve(root, 'apps/web/src/pages/checkout.astro'), 'utf8');
    expect(checkout).toContain('requestSession(Astro.locals, Astro.cookies)');
    expect(checkout).toContain("originDecision.allowed && !sessionUnknown\n  ? resolveCheckoutIntent");
    expect(checkout).toContain('resolveCartCredential(Astro.cookies, authenticatedUserId, { sessionUnknown })');
    const cart = readFileSync(resolve(root, 'apps/web/src/pages/cart.astro'), 'utf8');
    expect(cart).toContain("{ sessionUnknown: cartSession.state === 'UNKNOWN' }");
  });

  it('the header fallback only reads: it never mints or replaces a credential', () => {
    const root = resolve(__dirname, '../..');
    const nav = readFileSync(resolve(root, 'apps/web/src/components/GpNav.astro'), 'utf8');
    expect(nav).toContain('resolveCartCredential(Astro.cookies, headerUserId, { sessionUnknown: true })');
  });
});

describe('signing in keeps the basket', () => {
  it('asks for the account basket with the guest credential, then names it', async () => {
    const guestToken = credential('GUEST', 'g-1', GUEST_CART);
    const cookies = jar({ goldplus_session: 'tok', [COOKIE]: guestToken });
    const accountCart = vi.fn(async () => ACCOUNT_CART);
    const identity = await resolveRequestIdentity(cookies as never, {
      check: async () => ({ state: 'USER', customer: { userId: 'u-1', apiCredential: 'tok' } }),
      accountCart,
    });
    expect(accountCart).toHaveBeenCalledWith('tok', guestToken);
    expect(identity.gpUserId).toBe('u-1');
    const claims = claimsOf(identity.gpCart!.token);
    expect(claims).toMatchObject({ ownerKind: 'USER', ownerId: 'u-1', cartId: ACCOUNT_CART });
  });

  it('does not ask when the credential already matches', async () => {
    const token = credential('USER', 'u-1', USER_CART);
    const accountCart = vi.fn(async () => ACCOUNT_CART);
    const identity = await resolveRequestIdentity(jar({ goldplus_session: 'tok', [COOKIE]: token }) as never, {
      check: async () => ({ state: 'USER', customer: { userId: 'u-1', apiCredential: 'tok' } }),
      accountCart,
    });
    expect(accountCart).not.toHaveBeenCalled();
    expect(identity.gpCart?.token).toBe(token);
  });

  it('falls back to a fresh basket when the API cannot answer', async () => {
    const identity = await resolveRequestIdentity(jar({ goldplus_session: 'tok' }) as never, {
      check: async () => ({ state: 'USER', customer: { userId: 'u-1', apiCredential: 'tok' } }),
      accountCart: async () => null,
    });
    const claims = claimsOf(identity.gpCart!.token);
    expect(claims.ownerKind).toBe('USER');
    expect(claims.cartId).not.toBe(ACCOUNT_CART);
  });
});

describe('ResolveAccountCartUseCase', () => {
  function setup(records: CartRecord[], purchasable: string[], latest: string | null) {
    const store = new Map(records.map((r) => [r.id, structuredClone(r)]));
    const merges: unknown[] = [];
    const carts: ICartAuthorizedRepository = {
      find: async (id) => (store.has(id) ? structuredClone(store.get(id)!) : null),
      create: async () => undefined,
      claimOwnership: async () => false,
      replaceItems: async () => false,
    };
    const accounts: IAccountCartRepository = {
      findLatestFor: async () => (latest ? { id: latest } : null),
      mergeInto: async (args) => {
        merges.push(args);
        const guest = store.get(args.guestCartId)!;
        if (guest.version !== args.guestVersion) return false;
        guest.items = [];
        guest.version += 1;
        return true;
      },
    };
    const uc = new ResolveAccountCartUseCase({
      carts,
      accounts,
      products: { findPurchasable: async (ids) => ids.filter((id) => purchasable.includes(id)).map((id) => ({ id, name: id, unitPriceUgx: 1 })) },
      newCartId: () => 'new-cart',
    });
    return { uc, merges };
  }
  const line = (productId: string, quantity: number) => ({ productId, name: productId, unitPriceUgx: 1, quantity });
  const guest = (items: CartRecord['items']): CartRecord => ({ id: 'guest-cart', version: 4, ownerKind: 'GUEST', ownerId: 'g-1', items });
  const account = (items: CartRecord['items']): CartRecord => ({ id: 'acct', version: 2, ownerKind: 'USER', ownerId: 'u-1', items });

  it('returns the newest account basket when there is no guest basket', async () => {
    const { uc, merges } = setup([account([line('a', 1)])], ['a'], 'acct');
    expect(await uc.execute({ userId: 'u-1' })).toEqual({ cartId: 'acct', mergedLines: 0 });
    expect(merges).toEqual([]);
  });

  it('merges guest lines into the account basket, capped, dropping withdrawn products', async () => {
    const { uc, merges } = setup(
      [account([line('a', MAX_LINE_QUANTITY - 1)]), guest([line('a', 5), line('b', 2), line('gone', 1)])],
      ['a', 'b'],
      'acct',
    );
    const result = await uc.execute({ userId: 'u-1', guest: { cartId: 'guest-cart', ownerId: 'g-1' } });
    expect(result).toEqual({ cartId: 'acct', mergedLines: 2 });
    expect(merges[0]).toMatchObject({
      guestCartId: 'guest-cart',
      guestVersion: 4,
      targetCartId: 'acct',
      targetExpectedVersion: 2,
      items: [
        { productId: 'a', quantity: MAX_LINE_QUANTITY },
        { productId: 'b', quantity: 2 },
      ],
    });
  });

  it('creates the account basket from the guest basket when the customer has none', async () => {
    const { uc, merges } = setup([guest([line('b', 1)])], ['b'], null);
    expect(await uc.execute({ userId: 'u-1', guest: { cartId: 'guest-cart', ownerId: 'g-1' } })).toEqual({
      cartId: 'new-cart',
      mergedLines: 1,
    });
    expect(merges[0]).toMatchObject({ targetCartId: 'new-cart', targetExpectedVersion: null });
  });

  it('never adopts a basket the guest credential does not own', async () => {
    const { uc, merges } = setup([guest([line('b', 1)])], ['b'], 'acct');
    expect(await uc.execute({ userId: 'u-1', guest: { cartId: 'guest-cart', ownerId: 'someone-else' } })).toEqual({
      cartId: 'acct',
      mergedLines: 0,
    });
    expect(merges).toEqual([]);
  });

  it('a second call finds the guest basket empty and merges nothing twice', async () => {
    const { uc } = setup([account([]), guest([line('b', 1)])], ['b'], 'acct');
    await uc.execute({ userId: 'u-1', guest: { cartId: 'guest-cart', ownerId: 'g-1' } });
    expect(await uc.execute({ userId: 'u-1', guest: { cartId: 'guest-cart', ownerId: 'g-1' } })).toEqual({
      cartId: 'acct',
      mergedLines: 0,
    });
  });
});
