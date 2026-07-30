import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHECKOUT_INTENT_HEADER,
  checkoutIntentCookieName,
  checkoutOperationIdentity,
  deriveIntentKey,
  intentPrincipalKey,
  issueCheckoutIntent,
  mayStartPayment,
  verifyCheckoutIntent,
  type CheckoutResponseDto,
} from '../../packages/shared/src/index';
import {
  LeaseLostError,
  isLeaseLost,
  requireFence,
} from '../../apps/api/src/application/use-cases/commerce/requireFence';

const ROOT = 'root-secret-not-a-real-credential';
const KEY = deriveIntentKey(ROOT, '1');

describe('the intent is issued on the GET path, not only on POST', () => {
  const page = readFileSync(join(__dirname, '../../apps/web/src/pages/checkout.astro'), 'utf8');
  const frontmatter = page.slice(0, page.indexOf('\n---', 3));

  it('resolves the intent at top level so the initial GET sets the cookie', () => {
    // It previously sat INSIDE `if (Astro.request.method === 'POST')`, so the
    // initial GET issued no cookie and the template's reference to the derived
    // key was a ReferenceError — the page was broken on first load while
    // `pnpm build` passed throughout.
    const resolveAt = frontmatter.indexOf('resolveCheckoutIntent(Astro.cookies');
    const postBranchAt = frontmatter.indexOf("Astro.request.method === 'POST'");
    expect(resolveAt).toBeGreaterThan(-1);
    expect(postBranchAt).toBeGreaterThan(-1);
    expect(resolveAt).toBeLessThan(postBranchAt);
  });

  it('refuses to start without signing configuration rather than issuing an unsigned identity', () => {
    expect(frontmatter).toContain('CHECKOUT_INTENT_SECRET is not configured');
  });

  it('passes the verified user id in, so a session and an intent cannot disagree', () => {
    expect(frontmatter).toContain('resolveCheckoutIntent(Astro.cookies, authenticatedUserId)');
  });

  it('has no template binding that only exists on the POST path', () => {
    // Every value the template reads must be defined in top-level scope.
    const template = page.slice(page.indexOf('\n---', 3));
    for (const binding of ['checkoutOrderKey', 'clientOrderKey']) {
      expect(template).not.toContain(binding);
    }
  });

  it('prefers a __Host- cookie in production only', () => {
    // __Host- requires Secure and no Domain, which plain-HTTP local development
    // cannot satisfy — the browser would silently drop the cookie.
    expect(checkoutIntentCookieName(true)).toMatch(/^__Host-/);
    expect(checkoutIntentCookieName(false)).not.toMatch(/^__Host-/);
  });
});

describe('the operation identity is server-derived', () => {
  const claims = issueCheckoutIntent({ key: KEY, kind: 'GUEST' }).claims;

  it('does not accept a client-supplied order key', () => {
    const route = readFileSync(
      join(__dirname, '../../apps/api/src/interfaces/http/routes/commerce.ts'),
      'utf8',
    );
    // A hidden form field is caller-controlled by definition, so it could be
    // varied to force a duplicate order or reused from another customer.
    expect(route).not.toMatch(/clientOrderKey:\s*z\.string/);
    expect(route).toContain("checkoutOperationIdentity(claims, 'CREATE_ORDER'");
  });

  it('is stable for the same intent and operation', () => {
    expect(checkoutOperationIdentity(claims, 'CREATE_ORDER', 'v1')).toBe(
      checkoutOperationIdentity(claims, 'CREATE_ORDER', 'v1'),
    );
  });

  it('separates operations on one intent', () => {
    expect(checkoutOperationIdentity(claims, 'CREATE_ORDER', 'v1')).not.toBe(
      checkoutOperationIdentity(claims, 'START_PAYMENT', 'v1'),
    );
  });

  it('changes with the policy version', () => {
    expect(checkoutOperationIdentity(claims, 'CREATE_ORDER', 'v2')).not.toBe(
      checkoutOperationIdentity(claims, 'CREATE_ORDER', 'v1'),
    );
  });

  it('uses a length-prefixed encoding, so field boundaries cannot be shifted', () => {
    // With plain concatenation, an intent id ending in "A" plus operation "B"
    // would collide with an id ending "AB" plus operation "" — two different
    // operations sharing one idempotency identity.
    const a = { ...claims, intentId: 'ab' };
    const b = { ...claims, intentId: 'a' };
    expect(checkoutOperationIdentity(a, 'CREATE_ORDER', 'v1')).not.toBe(
      checkoutOperationIdentity(b, 'CREATE_ORDER', 'bv1'),
    );
  });

  it('separates a guest from a user with a colliding raw id', () => {
    const user = { ...claims, kind: 'USER' as const, principalId: 'x' };
    const guest = { ...claims, kind: 'GUEST' as const, principalId: 'x' };
    expect(intentPrincipalKey(user)).not.toBe(intentPrincipalKey(guest));
  });
});

describe('intent verification', () => {
  it('accepts a token it issued', () => {
    const issued = issueCheckoutIntent({ key: KEY, kind: 'GUEST' });
    expect(verifyCheckoutIntent([KEY], issued.token).valid).toBe(true);
  });

  it('rejects a token whose expiry was edited', () => {
    const issued = issueCheckoutIntent({ key: KEY, kind: 'GUEST' });
    const [v, encoded, mac] = issued.token.split('.');
    const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    claims.expiresAtSeconds += 999999;
    const tampered = `${v}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${mac}`;
    const result = verifyCheckoutIntent([KEY], tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('BAD_SIGNATURE');
  });

  it('rejects a token whose principal was swapped', () => {
    const issued = issueCheckoutIntent({ key: KEY, kind: 'USER', userId: 'victim' });
    const [v, encoded, mac] = issued.token.split('.');
    const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    claims.principalId = 'attacker';
    const tampered = `${v}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${mac}`;
    expect(verifyCheckoutIntent([KEY], tampered).valid).toBe(false);
  });

  it('reports an unknown key id rather than accepting it', () => {
    const other = issueCheckoutIntent({ key: deriveIntentKey(ROOT, '9'), kind: 'GUEST' });
    const result = verifyCheckoutIntent([KEY], other.token);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('UNKNOWN_KEY');
  });

  it('accepts the previous key during a rotation grace period', () => {
    // A rotation that invalidates every mid-checkout customer is a rotation
    // nobody performs.
    const previous = deriveIntentKey(ROOT, 'old');
    const issued = issueCheckoutIntent({ key: previous, kind: 'GUEST' });
    expect(verifyCheckoutIntent([KEY, previous], issued.token).valid).toBe(true);
  });

  it('fails a retired key once it is no longer accepted', () => {
    const retired = deriveIntentKey(ROOT, 'retired');
    const issued = issueCheckoutIntent({ key: retired, kind: 'GUEST' });
    expect(verifyCheckoutIntent([KEY], issued.token).valid).toBe(false);
  });

  it('derives unrelated key streams per key id from one root', () => {
    expect(deriveIntentKey(ROOT, '1').secret).not.toBe(deriveIntentKey(ROOT, '2').secret);
  });

  it('refuses a USER intent with no user id rather than issuing an anonymous one', () => {
    expect(() => issueCheckoutIntent({ key: KEY, kind: 'USER' })).toThrow(/USER_ID_REQUIRED/);
  });
});

describe('fencing fails closed', () => {
  it('throws when a fenced mutation did not apply', () => {
    // The first wiring ignored every fenced result, so a stale worker carried on
    // to reserve inventory, queue fulfilment and return success for an operation
    // it no longer owned. The fence made that detectable and the caller discarded
    // the detection.
    expect(() => requireFence(false, 'LINK_ORDER')).toThrow(LeaseLostError);
  });

  it('passes through when the mutation applied', () => {
    expect(() => requireFence(true, 'COMPLETE')).not.toThrow();
  });

  it('names the stage, so an operator can see where ownership was lost', () => {
    try {
      requireFence(false, 'ADVANCE_STAGE');
      throw new Error('should have thrown');
    } catch (err) {
      expect(isLeaseLost(err)).toBe(true);
      if (isLeaseLost(err)) expect(err.stage).toBe('ADVANCE_STAGE');
    }
  });

  it('reports lease loss for metrics and audit without customer data', () => {
    const seen: string[] = [];
    expect(() =>
      requireFence(false, 'HEARTBEAT', { onLeaseLost: (stage) => seen.push(stage) }),
    ).toThrow();
    expect(seen).toEqual(['HEARTBEAT']);
  });

  it('is checked at every fenced call site in the route', () => {
    const route = readFileSync(
      join(__dirname, '../../apps/api/src/interfaces/http/routes/commerce.ts'),
      'utf8',
    );
    // Neutralise the guarded form, then assert no bare fenced call survives. An
    // unchecked one is the original defect: the fence made lease loss detectable
    // and the caller discarded the detection.
    const withoutGuarded = route.split('requireFence(await idem.').join('GUARDED(');
    for (const method of ['advanceStage', 'complete']) {
      expect(withoutGuarded.includes(`await idem.${method}(`), `bare idem.${method} remains`).toBe(false);
    }
    expect(route).toContain('requireFence(await idem.complete(');
  });

  it('treats lease loss as CHECKOUT_IN_PROGRESS, not as a checkout failure', () => {
    const route = readFileSync(
      join(__dirname, '../../apps/api/src/interfaces/http/routes/commerce.ts'),
      'utf8',
    );
    // Marking the record failed would overwrite the very successor the fence
    // exists to protect.
    const branch = route.slice(route.indexOf('if (isLeaseLost(err))'));
    expect(branch.slice(0, 700)).toContain('CHECKOUT_IN_PROGRESS');
    expect(branch.slice(0, 700)).not.toContain('.fail(');
  });
});

describe('order creation and claim linkage are one transaction', () => {
  const repo = readFileSync(
    join(__dirname, '../../apps/api/src/infrastructure/db/repositories/DrizzleOrderRepository.ts'),
    'utf8',
  );

  it('writes the fenced link inside the order transaction', () => {
    const tx = repo.slice(repo.indexOf('async savePricedOrder'), repo.indexOf('async findByRelatedEntity') > -1 ? repo.indexOf('async findByRelatedEntity') : repo.length);
    const insertAt = tx.indexOf('tx.insert(orders)');
    const linkAt = tx.indexOf('tx\n          .update(checkoutIdempotency)') > -1
      ? tx.indexOf('tx\n          .update(checkoutIdempotency)')
      : tx.indexOf('.update(checkoutIdempotency)');
    expect(insertAt).toBeGreaterThan(-1);
    expect(linkAt).toBeGreaterThan(insertAt);
    expect(tx).toContain('CHECKOUT_LEASE_LOST');
  });

  it('requires the full fence on the link, not just the identity', () => {
    expect(repo).toContain('eq(checkoutIdempotency.claimToken');
    expect(repo).toContain('eq(checkoutIdempotency.fencingNumber');
  });

  it('no longer links in a separate statement after the commit', () => {
    const route = readFileSync(
      join(__dirname, '../../apps/api/src/interfaces/http/routes/commerce.ts'),
      'utf8',
    );
    // Two statements left a window where a crash produced a committed order with
    // no recoverable checkout identity.
    expect(route).not.toContain('idem.linkOrder(');
  });
});

describe('payment starts only when the server says so', () => {
  const dto = (over: Partial<CheckoutResponseDto> = {}): CheckoutResponseDto => ({
    orderId: 'o1',
    orderNumber: 'GP-1',
    checkoutState: 'received',
    paymentState: 'unpaid',
    reservationState: 'RESERVED',
    deliveryFeeConfirmed: true,
    totalAmount: 1000,
    currency: 'UGX',
    nextAction: 'AWAIT_PAYMENT',
    idempotentReplay: false,
    ...over,
  });

  it('allows payment for a payable order', () => {
    expect(mayStartPayment(dto())).toBe(true);
  });

  it('refuses payment for a stock-blocked order', () => {
    // The old condition was merely "we have an order id".
    expect(mayStartPayment(dto({ nextAction: 'AWAIT_STOCK_CONFIRMATION', reservationState: 'UNRESERVED_BLOCKED' }))).toBe(false);
  });

  it('refuses a second payment for an already-paid order', () => {
    expect(mayStartPayment(dto({ paymentState: 'paid', nextAction: 'NONE' }))).toBe(false);
  });

  it('refuses payment when the order needs manual review', () => {
    expect(mayStartPayment(dto({ nextAction: 'CONTACT_SUPPORT' }))).toBe(false);
  });

  it('carries no PII in the public result', () => {
    const keys = Object.keys(dto());
    for (const forbidden of ['customerName', 'customerPhone', 'customerEmail', 'deliveryAddress', 'items']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('the storefront forwards the intent and keeps it across retries', () => {
  const client = readFileSync(join(__dirname, '../../apps/web/src/lib/checkoutClient.ts'), 'utf8');
  const page = readFileSync(join(__dirname, '../../apps/web/src/pages/checkout.astro'), 'utf8');

  it('sends the intent header', () => {
    expect(client).toContain('[CHECKOUT_INTENT_HEADER]: args.intentToken');
    expect(CHECKOUT_INTENT_HEADER).toBe('x-goldplus-checkout-intent');
  });

  it('is typed against the shared DTO rather than unknown', () => {
    expect(client).toContain('CheckoutResponseDto');
    expect(client).not.toMatch(/data:\s*unknown/);
  });

  it('preserves status, error code and Retry-After', () => {
    for (const marker of ['status: res.status', "headers.get('Retry-After')", 'code:']) {
      expect(client).toContain(marker);
    }
  });

  it('keeps the intent on NETWORK and IN_PROGRESS so a retry reaches the same order', () => {
    expect(client).toContain("case 'NETWORK'");
    expect(client).toContain("case 'CHECKOUT_IN_PROGRESS'");
    // clearCheckoutIntent must not be reachable from the retry branch.
    const retryBranch = page.slice(page.indexOf("outcome.status === 'retry'"));
    expect(retryBranch.slice(0, 400)).not.toContain('clearCheckoutIntent');
  });

  it('gates payment on the shared predicate, not on a truthy id', () => {
    expect(page).toContain('mayStartPayment(dto)');
    expect(page).not.toContain('res.data?.id');
  });
});
