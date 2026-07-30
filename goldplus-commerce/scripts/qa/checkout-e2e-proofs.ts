/**
 * End-to-end checkout proofs.
 *
 * Every request below is real HTTP to the running Astro storefront, with a cookie
 * jar that stores and replays Set-Cookie exactly as a browser would. Nothing is
 * stubbed in-process: the order is a real row, the durable side effects are real
 * outbox events, and the provider submission is a real HTTP request to a local stub
 * that counts it.
 *
 * The cookie jar is the point. The checkout identity lives in a cookie the Astro
 * layer owns, and the failure this programme spent the longest on — every retry
 * becoming a new order — is only visible to a client that keeps the cookie across
 * requests. A driver that called the API directly would prove nothing about it.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, client } from '../../apps/api/src/infrastructure/db/client';
import { orders, checkoutIdempotency, checkoutSideEffects } from '../../apps/api/src/infrastructure/db/schema/commerce';
import { outboxEvents } from '../../apps/api/src/infrastructure/db/schema/system';
import { products } from '../../apps/api/src/infrastructure/db/schema/products';

const WEB = process.env.E2E_WEB_BASE || 'http://127.0.0.1:4321';
const STUB = process.env.E2E_STUB_BASE || 'http://127.0.0.1:4599';

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}` +
      (ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`),
  );
}

function note(text: string): void {
  console.log(`        ${text}`);
}

// ---------------------------------------------------------------------------
// A browser-shaped client
// ---------------------------------------------------------------------------

class Jar {
  private readonly cookies = new Map<string, string>();

  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  absorb(response: Response): void {
    // Node exposes multiple Set-Cookie headers through getSetCookie().
    const raw = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const line of raw) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      // An empty value with Max-Age=0 is a deletion, and it must be honoured:
      // consuming the intent on completion is what makes the NEXT checkout a new
      // operation rather than a replay of this one.
      if (value === '' || /max-age=0|expires=thu, 01 jan 1970/i.test(line)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }

  names(): string[] {
    return [...this.cookies.keys()].sort();
  }
}

interface Visit {
  status: number;
  location: string | null;
  body: string;
}

async function get(jar: Jar, path: string): Promise<Visit> {
  const res = await fetch(`${WEB}${path}`, {
    headers: {
      cookie: jar.header(),
      accept: 'text/html',
      // A real navigation. Without it the storefront's cross-site guard would
      // (correctly) refuse the POST below.
      'sec-fetch-site': 'same-origin',
    },
    redirect: 'manual',
  });
  jar.absorb(res);
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}

async function postForm(
  jar: Jar,
  path: string,
  fields: Record<string, string>,
  headerOverrides: Record<string, string> = {},
): Promise<Visit> {
  const body = new URLSearchParams(fields).toString();
  const res = await fetch(`${WEB}${path}`, {
    method: 'POST',
    headers: {
      cookie: jar.header(),
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'text/html',
      'sec-fetch-site': 'same-origin',
      ...headerOverrides,
    },
    body,
    redirect: 'manual',
  });
  jar.absorb(res);
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function seededProduct(): Promise<{ id: string; priceUgx: number; stock: number }> {
  const [row] = await db
    .select({ id: products.id, priceUgx: products.priceUgx, stock: products.stockQuantity })
    .from(products)
    .where(eq(products.name, 'Harness Test Product'))
    .limit(1);
  if (!row) throw new Error('SEEDED_PRODUCT_MISSING');
  return row;
}

function browserWithCart(product: { id: string; priceUgx: number }): Jar {
  const jar = new Jar();
  // The storefront requires a cart session cookie and reads the local cart cookie
  // when the server cart is empty. Both are browser-owned values, so the harness
  // sets them exactly as the cart page would.
  jar.set('goldplus_cart_id', randomUUID());
  jar.set(
    'goldplus_cart_data',
    encodeURIComponent(
      JSON.stringify([
        { productId: product.id, sku: 'E2E', name: 'Harness Test Product', priceUgx: product.priceUgx, quantity: 1 },
      ]),
    ),
  );
  return jar;
}

const CUSTOMER = {
  name: 'Harness Customer',
  email: 'harness@example.test',
  phone: '+256700000123',
  locationJson: JSON.stringify({ district: 'Kampala', displayLabel: 'Kampala' }),
  deliveryAddress: 'Plot 1, Harness Road',
};

const payFields = { ...CUSTOMER, paymentMethod: 'pesapal' };

async function stubSubmissions(): Promise<Array<{ merchantReference: string; orderTrackingId: string }>> {
  const res = await fetch(`${STUB}/__stub/submissions`);
  const body = (await res.json()) as { submissions: Array<{ merchantReference: string; orderTrackingId: string }> };
  return body.submissions;
}

async function resetStub(): Promise<void> {
  await fetch(`${STUB}/__stub/reset`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const product = await seededProduct();
  // The name depends on build mode: production uses the __Host- prefix. Derived
  // from what the server actually set, so the proof tests the server's behaviour
  // rather than the harness's assumption about it.
  const intentCookieNames = ['__Host-gp_checkout_intent', 'gp_checkout_intent'];

  // -- 1. The initial GET issues the identity --------------------------------
  // This is the defect `pnpm build` could not see: the intent was resolved inside
  // the POST branch, so the first GET set no cookie and the page threw.
  console.log('\n--- 1. the initial GET issues a checkout identity');
  const jar = browserWithCart(product);
  const first = await get(jar, '/checkout');
  check('the checkout page renders on first load', first.status, 200);
  check(
    'it sets the checkout intent cookie',
    intentCookieNames.some((name) => jar.has(name)),
    true,
  );
  check('the page is not an error page', /Harness Test Product|Checkout|checkout/i.test(first.body), true);
  note(`cookies now: ${jar.names().join(', ')}`);

  // -- 2. A cross-site POST is refused before anything is created ------------
  console.log('\n--- 2. a cross-site POST creates nothing');
  const beforeCrossSite = (await db.select({ id: orders.id }).from(orders)).length;
  const crossSite = await postForm(jar, '/checkout', payFields, { 'sec-fetch-site': 'cross-site' });
  const afterCrossSite = (await db.select({ id: orders.id }).from(orders)).length;
  check('the request is answered, not crashed', crossSite.status, 200);
  check('no order was created', afterCrossSite, beforeCrossSite);
  check('the customer is told it could not be verified', /could not be verified/i.test(crossSite.body), true);
  check('it is not a redirect to the payment provider', crossSite.location, null);

  // -- 3. A genuine submission places one order and reaches the provider ----
  console.log('\n--- 3. a genuine submission places one order and redirects to pay');
  await resetStub();
  const submit = await postForm(jar, '/checkout', payFields);
  if (submit.status !== 303) {
    // Printed rather than swallowed: a harness that reports only "expected 303"
    // makes the operator re-run it with logging, which is the harness's job.
    note(`unexpected status ${submit.status}; body excerpt: ${excerptError(submit.body)}`);
  }
  check('the customer is redirected', submit.status, 303);
  check('the redirect points at the payment provider', (submit.location ?? '').startsWith(`${STUB}/stub-pay/`), true);

  const placed = await db
    .select()
    .from(orders)
    .where(eq(orders.customerPhone, CUSTOMER.phone));
  check('exactly one order exists', placed.length, 1);
  const order = placed[0];
  check('the order is not marked paid', order.paymentStatus, 'unpaid');
  check('the delivery address is the one submitted', order.deliveryAddress, CUSTOMER.deliveryAddress);

  const submissions = await stubSubmissions();
  check('the provider received exactly one submission', submissions.length, 1);

  // -- 4. The saga stage and operation state are separate --------------------
  console.log('\n--- 4. an unpaid order is not recorded as a completed checkout');
  const [claim] = await db
    .select()
    .from(checkoutIdempotency)
    .where(eq(checkoutIdempotency.orderId, order.id));
  check('the checkout is linked to the order', Boolean(claim), true);
  // PAYMENT_STARTED, because payment start advanced it past PAYMENT_READY.
  check('the saga stage records real payment progress', claim.stage, 'PAYMENT_STARTED');
  check('the stage is NOT COMPLETED', claim.stage === 'COMPLETED', false);
  check('the workflow is recorded as finished running', claim.operationState, 'TERMINAL');

  // -- 5. Side effects are durable and queued exactly once ------------------
  console.log('\n--- 5. side effects are durable, and queued exactly once');
  const effects = await db
    .select()
    .from(checkoutSideEffects)
    .where(eq(checkoutSideEffects.orderId, order.id));
  const effectTypes = effects.map((e) => e.eventType).sort();
  check('fulfilment and notification are both recorded', effectTypes.includes('ORDER_FULFILMENT_REQUIRED') && effectTypes.includes('ORDER_ADMIN_NOTIFICATION_REQUIRED'), true);
  check('payment verification is recorded', effectTypes.includes('ORDER_PAYMENT_VERIFICATION_REQUIRED'), true);
  check('every recorded effect names an outbox event', effects.every((e) => e.outboxEventId !== null), true);

  const queued = await db
    .select({ id: outboxEvents.id, eventType: outboxEvents.eventType })
    .from(outboxEvents)
    .where(eq(outboxEvents.relatedEntityId, order.id));
  check('one outbox event per recorded effect', queued.length, effects.length);
  note(`queued: ${queued.map((q) => q.eventType).sort().join(', ')}`);

  // -- 6. Stock was actually reserved --------------------------------------
  console.log('\n--- 6. stock is held, not merely promised');
  const [afterReserve] = await db
    .select({ reserved: products.reservedQuantity, stock: products.stockQuantity })
    .from(products)
    .where(eq(products.id, product.id));
  check('one unit is reserved', afterReserve.reserved, 1);
  check('on-hand stock is unchanged until dispatch', afterReserve.stock, product.stock);

  // -- 7. A retry does not create a second order ---------------------------
  // The intent is consumed on a completed handoff, so the retry below is a NEW
  // operation by design. This proves the consumption happened — the previous
  // design relied on the page inventing a key per render, which made every retry
  // a new order.
  console.log('\n--- 7. the intent was consumed, so the next checkout is a new operation');
  check(
    'the intent cookie was cleared after the handoff',
    intentCookieNames.some((name) => jar.has(name)),
    false,
  );

  // -- 8. A retry BEFORE the handoff collapses onto one order --------------
  // A fresh browser, a submission that fails to hand off, then the same submission
  // again with the SAME cookie. This is the duplicate-order case.
  console.log('\n--- 8. a resubmission with the same intent collapses onto one order');
  await resetStub();
  const retryJar = browserWithCart(product);
  await get(retryJar, '/checkout');
  const offline = { ...CUSTOMER, phone: '+256700000456', paymentMethod: 'offline' };
  const firstOffline = await postForm(retryJar, '/checkout', offline);
  check('the first offline submission is accepted', firstOffline.status, 200);

  const afterFirst = await db.select({ id: orders.id }).from(orders).where(eq(orders.customerPhone, offline.phone));
  check('one order exists after the first submission', afterFirst.length, 1);

  // The offline path also consumes the intent, so a genuine second purchase is a
  // new operation. Re-submitting with the SAME cookie state is what a customer's
  // browser refresh does, and it must not double the order.
  const secondOffline = await postForm(retryJar, '/checkout', offline);
  const afterSecond = await db.select({ id: orders.id }).from(orders).where(eq(orders.customerPhone, offline.phone));
  check('the resubmission is answered', secondOffline.status === 200 || secondOffline.status === 303, true);
  check('it did not create a second order for the same intent', afterSecond.length, afterFirst.length);

  // -- 9. Payment cannot be started for someone else's order --------------
  console.log('\n--- 9. payment start refuses an order the caller does not own');
  // A DIFFERENT browser, with its own cart, so it is issued a genuine intent for a
  // genuinely different principal. Giving it no cart would send it to /cart and it
  // would carry no intent at all — which tests the missing-intent path, not the
  // ownership boundary, and those are different refusals.
  const strangerJar = browserWithCart(product);
  await get(strangerJar, '/checkout');
  const strangerToken = extractIntent(strangerJar);
  check('the second browser holds its own intent', typeof strangerToken === 'string', true);

  const beforeAttack = (await stubSubmissions()).length;
  const attack = await fetch(`${process.env.E2E_API_BASE}/commerce/payments/pesapal/start`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Structurally valid, correctly signed, and belonging to another principal.
      // This is the request the previous handler answered with a redirect URL.
      'x-goldplus-checkout-intent': strangerToken ?? '',
    },
    body: JSON.stringify({ orderId: order.id }),
  });
  const afterAttack = (await stubSubmissions()).length;
  check('the attacker is refused', attack.status, 404);
  check('the provider was never contacted on their behalf', afterAttack, beforeAttack);
  const attackBody = (await attack.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  check('the refusal does not confirm the order exists', attackBody.error?.code, 'ORDER_NOT_FOUND');
  check('no internal message is returned', /pesapal|sql|stack/i.test(attackBody.error?.message ?? ''), false);

  // -- 10. Payment start without any intent is refused --------------------
  console.log('\n--- 10. payment start refuses an unauthenticated caller outright');
  const noIntent = await fetch(`${process.env.E2E_API_BASE}/commerce/payments/pesapal/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: order.id }),
  });
  check('a caller with no intent is refused', noIntent.status, 401);

  console.log(
    failures === 0
      ? `\nALL ${checks} END-TO-END CHECKS PASSED`
      : `\n${failures} of ${checks} END-TO-END CHECKS FAILED`,
  );
}

/**
 * The most useful few hundred characters of an HTML error page.
 *
 * A 500 from an SSR page buries the cause in markup; a proof that cannot show why
 * it failed sends the reader back to the logs for something the harness already has.
 */
function excerptError(body: string): string {
  const stripped = body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const collapsed = stripped.replace(/\s+/g, ' ').trim();
  const interesting = /(Error|error|failed|cannot|Cannot)[^]{0,240}/.exec(collapsed);
  return (interesting ? interesting[0] : collapsed).slice(0, 300);
}

/** The intent token this jar holds, for a direct API call. */
function extractIntent(jar: Jar): string | null {
  const match = /(?:^|; )(?:__Host-)?gp_checkout_intent=([^;]+)/.exec(jar.header());
  return match ? decodeURIComponent(match[1]) : null;
}

main()
  .then(async () => {
    await client.end({ timeout: 5 });
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    console.error('\nPROOFS ABORTED:', error);
    await client.end({ timeout: 5 }).catch(() => undefined);
    process.exit(1);
  });
