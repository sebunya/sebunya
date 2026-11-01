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
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
/** Where the photo proof leaves its card's code and reference for a screenshot run (local only; never in CI). */
const E2E_GIFT_PHOTO_OUT = process.env.E2E_GIFT_PHOTO_OUT ?? '';
import { and, eq } from 'drizzle-orm';
import { db, client } from '../../apps/api/src/infrastructure/db/client';
import { orders, checkoutIdempotency, checkoutSideEffects } from '../../apps/api/src/infrastructure/db/schema/commerce';
import { outboxEvents } from '../../apps/api/src/infrastructure/db/schema/system';
import { products } from '../../apps/api/src/infrastructure/db/schema/products';
import { sql } from 'drizzle-orm';
import { DrizzleCreditRepository } from '../../apps/api/src/infrastructure/credit/DrizzleCreditRepository';
import { creditCodeHash, creditRandomIndexes } from '../../apps/api/src/infrastructure/credit/CreditCodeCrypto';
import { newCreditCode } from '../../apps/api/src/domain/credit/CreditInstrument';

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
      // A browser always sends Origin on a form POST. Astro 6 refuses one without a matching Origin (403), so a
      // client that omits it is not browser-shaped and every submission below failed for that reason alone.
      origin: WEB,
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
  const crossSite = await postForm(jar, '/checkout', payFields, { 'sec-fetch-site': 'cross-site', origin: 'https://attacker.example' });
  const afterCrossSite = (await db.select({ id: orders.id }).from(orders)).length;
  // Since Astro 6 the framework's own origin check refuses it before the page runs (stronger than the page's
  // own guard, which still answers a same-origin request whose fetch metadata says cross-site).
  check('the request is refused by the origin check', crossSite.status, 403);
  check('no order was created', afterCrossSite, beforeCrossSite);
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

  // -- 7. The intent SURVIVES the payment handoff ---------------------------
  // Clearing it at the redirect looked like tidy consumption, but the handoff is where
  // the customer leaves this system, and every way back needs the same identity: a lost
  // redirect on a flaky connection, a refresh, a back-navigation, or the provider's own
  // return URL. Without it each of those is a NEW operation, and therefore a second
  // order for a customer who already has one being paid for.
  console.log('\n--- 7. the checkout intent survives the payment handoff');
  check(
    'the intent cookie is RETAINED across the redirect',
    intentCookieNames.some((name) => jar.has(name)),
    true,
  );
  // The basket became an order, so leaving the cart cookie would re-add the same items
  // to the next checkout.
  check('the cart cookie was cleared', jar.has('goldplus_cart_data'), false);

  // Returning to /checkout with that same intent must not place a second order. The
  // cart is now empty, so the page redirects rather than re-submitting — which is the
  // behaviour a customer coming back from the bank page actually meets.
  const ordersBeforeReturn = (await db.select({ id: orders.id }).from(orders)).length;
  const returning = await get(jar, '/checkout');
  const ordersAfterReturn = (await db.select({ id: orders.id }).from(orders)).length;
  check('returning from payment creates no new order', ordersAfterReturn, ordersBeforeReturn);
  check('the return is answered, not an error', returning.status === 200 || returning.status === 303, true);

  // -- 8. A retry BEFORE the handoff collapses onto one order --------------
  // A fresh browser, a submission that fails to hand off, then the same submission
  // again with the SAME cookie. This is the duplicate-order case.
  console.log('\n--- 8. a resubmission with the same intent collapses onto one order');
  await resetStub();
  const retryJar = browserWithCart(product);
  await get(retryJar, '/checkout');
  const offline = { ...CUSTOMER, phone: '+256700000456', paymentMethod: 'offline' };
  const firstOffline = await postForm(retryJar, '/checkout', offline);
  // Owner decision 2026-10-16: always online, so this is accepted by handing off to pay (303), not a page.
  check('the first submission is accepted', firstOffline.status === 200 || firstOffline.status === 303, true);

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

  // -- 11. Twenty concurrent identical submissions ------------------------
  // The claim mechanism's whole purpose. Sequential retries already collapse; this is
  // the case that needs the database to arbitrate, because twenty requests read the
  // same "no claim exists" at the same instant.
  console.log('\n--- 11. twenty concurrent identical submissions create ONE order');
  await resetStub();
  const burstJar = browserWithCart(product);
  await get(burstJar, '/checkout');
  const burstPhone = '+256700000789';
  const burstFields = { ...CUSTOMER, phone: burstPhone, paymentMethod: 'offline' };

  // All twenty share ONE cookie jar, which is what a real double-submitting browser
  // does. Fired without awaiting in between, so they genuinely overlap.
  const burst = await Promise.all(
    Array.from({ length: 20 }, () => postForm(burstJar, '/checkout', burstFields)),
  );
  check('every concurrent request was answered', burst.every((r) => r.status === 200 || r.status === 303), true);

  const burstOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.customerPhone, burstPhone));
  check('exactly ONE order exists', burstOrders.length, 1);

  const burstClaims = await db
    .select({ identity: checkoutIdempotency.identity })
    .from(checkoutIdempotency)
    .where(eq(checkoutIdempotency.orderId, burstOrders[0]?.id ?? ''));
  check('exactly ONE checkout claim owns it', burstClaims.length, 1);

  const burstEffects = await db
    .select({ eventType: checkoutSideEffects.eventType })
    .from(checkoutSideEffects)
    .where(eq(checkoutSideEffects.orderId, burstOrders[0]?.id ?? ''));
  const burstTypes = burstEffects.map((e) => e.eventType);
  check(
    'exactly ONE fulfilment event',
    burstTypes.filter((t) => t === 'ORDER_FULFILMENT_REQUIRED').length,
    1,
  );
  check(
    'exactly ONE admin notification event',
    burstTypes.filter((t) => t === 'ORDER_ADMIN_NOTIFICATION_REQUIRED').length,
    1,
  );

  const burstOutbox = await db
    .select({ id: outboxEvents.id })
    .from(outboxEvents)
    .where(eq(outboxEvents.relatedEntityId, burstOrders[0]?.id ?? ''));
  check('one outbox event per recorded effect, no duplicates', burstOutbox.length, burstEffects.length);

  // The reservation is the one that costs real money to get wrong: twenty reservations
  // for one order would hold twenty units of stock against a single sale.
  const [burstStock] = await db
    .select({ reserved: products.reservedQuantity })
    .from(products)
    .where(eq(products.id, product.id));
  note(`reserved units after the burst: ${burstStock.reserved}`);

  await giftCardProofs(product);

  console.log(
    failures === 0
      ? `\nALL ${checks} END-TO-END CHECKS PASSED`
      : `\n${failures} of ${checks} END-TO-END CHECKS FAILED`,
  );
}

// ---------------------------------------------------------------------------
// Gift cards and store credit (0196): the same real path, with a card on the form
// ---------------------------------------------------------------------------

const rowsOf = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, any>>;

async function issueCard(valueUgx: number): Promise<{ id: string; code: string }> {
  const code = newCreditCode('gift_card', creditRandomIndexes());
  const { id } = await new DrizzleCreditRepository().issue({
    kind: 'gift_card', codeHash: creditCodeHash(code), last4: code.slice(-4), valueUgx, reason: 'Harness card',
    status: 'active', recipientName: null, recipientPhone: null, customerUserId: null, sourceOrderId: null,
    issuedBy: '00000000-0000-4000-8000-00000000e2e0', expiresAt: null,
  });
  return { id, code };
}

async function cardState(id: string): Promise<{ balance: number; holds: string[] }> {
  const [b] = rowsOf(await db.execute(sql`select coalesce(sum(amount_ugx) filter (where not (type = 'HOLD' and hold_state = 'released')), 0)::int as balance from credit_ledger where instrument_id = ${id}`));
  const holds = rowsOf(await db.execute(sql`select hold_state from credit_ledger where instrument_id = ${id} and type = 'HOLD' order by created_at`)).map((r) => String(r.hold_state));
  return { balance: Number(b.balance), holds };
}

async function giftCardProofs(product: { id: string; priceUgx: number }): Promise<void> {
  // -- 12. Part paid by a gift card: Pesapal is asked only for the rest -------
  console.log('\n--- 12. a gift card pays part; Pesapal is asked only for the rest, and payment captures the card');
  await resetStub();
  const part = await issueCard(100_000);
  const partJar = browserWithCart(product);
  await get(partJar, '/checkout');
  const partPhone = '+256700000901';
  const partSubmit = await postForm(partJar, '/checkout', { ...payFields, phone: partPhone, storeCreditCode: part.code.toLowerCase().replace(/-/g, ' ') });
  if (partSubmit.status !== 303) note(`unexpected status ${partSubmit.status}; body excerpt: ${excerptError(partSubmit.body)}`);
  check('the customer is sent to pay', partSubmit.status, 303);
  const [partOrder] = await db.select().from(orders).where(eq(orders.customerPhone, partPhone));
  check('the order records the gift card part', Number(partOrder?.storeCreditAppliedUgx), 100_000);
  const partSubs = await stubSubmissions() as Array<{ merchantReference: string; orderTrackingId: string; amount?: number }>;
  check('Pesapal was asked for the total less the card', Number(partSubs[0]?.amount), Number(partOrder?.totalAmount) - 100_000);
  check('the card holds the money while the customer pays', await cardState(part.id), { balance: 0, holds: ['held'] });

  await fetch(`${STUB}/__stub/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderTrackingId: partSubs[0]?.orderTrackingId, status: 'COMPLETED' }) });
  const ipn = await fetch(`${process.env.E2E_API_BASE}/commerce/payments/pesapal/ipn?OrderTrackingId=${encodeURIComponent(partSubs[0]?.orderTrackingId ?? '')}&OrderMerchantReference=${encodeURIComponent(partSubs[0]?.merchantReference ?? '')}&OrderNotificationType=IPNCHANGE`);
  check('the provider notification is accepted', ipn.status, 200);
  const [paidPart] = await db.select().from(orders).where(eq(orders.id, partOrder.id));
  check('the order is paid', paidPart.paymentStatus, 'paid');
  check('the card hold is captured on payment', (await cardState(part.id)).holds, ['captured']);
  const mismatch = rowsOf(await db.execute(sql`select 1 from outbox_events where related_entity_id = ${partOrder.id} and payload::text ilike '%amount%mismatch%'`));
  check('paying the rest is not flagged as an underpayment', mismatch.length, 0);
  // The notifier stores payloads as a jsonb STRING (repo-wide drizzle gotcha), so the text is read through it.
  const paidSms = rowsOf(await db.execute(sql`select coalesce(payload->>'message', (payload #>> '{}')::jsonb->>'message') as m from outbox_events where related_entity_id = ${partOrder.id} and template = 'ORDER_PAYMENT_SUCCESS'`));
  check('the payment message names the split', /gift card or store credit UGX 100,000 \+ Mobile Money or card/.test(String(paidSms[0]?.m ?? '')), true);

  // -- 13. Paid in full by a gift card: no Pesapal at all ---------------------
  console.log('\n--- 13. a gift card that covers everything confirms the order with no payment page');
  await resetStub();
  const full = await issueCard(1_000_000);
  const fullJar = browserWithCart(product);
  await get(fullJar, '/checkout');
  const fullPhone = '+256700000902';
  const fullSubmit = await postForm(fullJar, '/checkout', { ...payFields, phone: fullPhone, storeCreditCode: full.code });
  check('the customer is sent to the order receipt, not to a payment page', (fullSubmit.location ?? '').startsWith('/checkout/confirmed'), true);
  const receipt = fullSubmit.location ? await get(fullJar, fullSubmit.location) : { status: 0, body: '' };
  check('the receipt opens', receipt.status, 200);
  check('it says the order is paid in full by the card', /paid in full with your gift card or store credit/i.test(receipt.body), true);
  check('Pesapal was never contacted', (await stubSubmissions()).length, 0);
  const [fullOrder] = await db.select().from(orders).where(eq(orders.customerPhone, fullPhone));
  check('the order is paid', fullOrder?.paymentStatus, 'paid');
  check('the card is charged exactly the order total', (await cardState(full.id)).balance, 1_000_000 - Number(fullOrder?.totalAmount));
  check('and the hold is captured', (await cardState(full.id)).holds, ['captured']);

  // -- 13b. Written directions with a pin and no district (2026-10-22) -------------
  console.log('\n--- 13b. written directions with a pasted map pin, no district picked: the order is placed and keeps the pin');
  await resetStub();
  const pinJar = browserWithCart(product);
  await get(pinJar, '/checkout');
  const pinPhone = '+256700000977';
  const pinSubmit = await postForm(pinJar, '/checkout', {
    ...payFields, phone: pinPhone,
    locationJson: JSON.stringify({ manual: true, rawAddressText: 'Behind the church, blue gate', gpsLat: 0.3501, gpsLng: 32.6101, gpsAccuracyM: 20, gpsSource: 'pasted_link' }),
  });
  if (pinSubmit.status !== 303) note(`unexpected status ${pinSubmit.status}; body excerpt: ${excerptError(pinSubmit.body)}`);
  check('the order is placed (the customer is sent to pay)', pinSubmit.status, 303);
  const [pinOrder] = await db.select().from(orders).where(eq(orders.customerPhone, pinPhone));
  check('the order keeps the pin for the rider', Number((pinOrder?.deliveryLocation as { gpsLat?: number } | null)?.gpsLat), 0.3501);

  // -- 14. A wrong code: nothing ordered, nothing charged ----------------------
  console.log('\n--- 14. a wrong code orders nothing and charges nothing');
  await resetStub();
  const badJar = browserWithCart(product);
  await get(badJar, '/checkout');
  const badPhone = '+256700000903';
  const bad = await postForm(badJar, '/checkout', { ...payFields, phone: badPhone, storeCreditCode: 'GPGC-AAAA-BBBB-CCCC' });
  check('the customer gets the page back, not a payment redirect', bad.status, 200);
  check('they are told the card cannot be used and nothing was charged', /gift card or store credit cannot be used[\s\S]{0,200}Nothing has been charged/i.test(bad.body), true);
  check('no order exists', (await db.select({ id: orders.id }).from(orders).where(eq(orders.customerPhone, badPhone))).length, 0);
  check('Pesapal was never contacted', (await stubSubmissions()).length, 0);
  check('the code is kept on the form to correct', bad.body.includes('GPGC-AAAA-BBBB-CCCC'), true);

  await giftCardPurchaseProofs();
  await referralProofs();
}

// ---------------------------------------------------------------------------
// 0202: refer a friend through the real storefront — the short link, the welcome, nothing to type
// ---------------------------------------------------------------------------

async function signUp(jar: Jar, email: string, phone: string, referralCode = ''): Promise<Visit> {
  return postForm(jar, '/register', { email, phone, password: 'Harness-pass-123', confirmPassword: 'Harness-pass-123', referralCode });
}

async function referralProofs(): Promise<void> {
  console.log('\n--- 16. refer a friend: link, welcome, sign-up with nothing typed, the referrer sees them');
  const hadConfig = rowsOf(await db.execute(sql`select count(*)::int as n from loyalty_config`))[0].n > 0;
  if (!hadConfig) await db.execute(sql`insert into loyalty_config (enabled, kill_switch, referral_referrer_points, referral_referee_points) values (true, false, 200, 100)`);
  else await db.execute(sql`update loyalty_config set enabled = true, kill_switch = false, referral_referrer_points = 200, referral_referee_points = 100`);

  const referrer = new Jar();
  const signedUp = await signUp(referrer, 'referrer-e2e@goldplus.test', '0700000981');
  check('the referrer signs up', signedUp.status, 303);
  const rewards = await get(referrer, '/account/rewards');
  const code = rewards.body.match(/data-referral-code[^>]*>([A-Z0-9]{4,12})</)?.[1] ?? '';
  check('their invite card shows their code', code.length >= 4, true);
  check('the copy button carries the short /r/ link', rewards.body.includes(`/r/${code}?via=copy`), true);
  // WhatsApp and SMS carry the link inside their own (encoded) message.
  check('WhatsApp and SMS send the same short link', rewards.body.includes(encodeURIComponent(`/r/${code}?via=whatsapp`)) && rewards.body.includes(encodeURIComponent(`/r/${code}?via=sms`)), true);

  // A link preview (WhatsApp drawing the card) is not a person.
  const preview = await fetch(`${WEB}/r/${code}?via=whatsapp`, { headers: { 'user-agent': 'WhatsApp/2.24.1.0 A' }, redirect: 'manual' });
  check('a link preview is redirected to the welcome', preview.status, 302);
  const opensBefore = rowsOf(await db.execute(sql`select count(*)::int as n from loyalty_referral_visits where code = ${code}`))[0].n;
  check('a link preview is not counted as an open', opensBefore, 0);

  const friend = new Jar();
  const opened = await get(friend, `/r/${code.toLowerCase()}?via=whatsapp`);
  check('the friend is sent to the welcome page', opened.status, 302);
  check('tagged as a friend\'s invite for the channel report', /^\/invite\?code=[A-Z0-9]+&utm_source=customer_invite&utm_medium=friend/.test(opened.location ?? ''), true);
  check('the invite is remembered in this browser', friend.has('gp_ref'), true);
  const visits = rowsOf(await db.execute(sql`select how, opens from loyalty_referral_visits where code = ${code}`));
  check('the open is counted once, by the button used', visits.map((v) => `${v.how}:${v.opens}`).join(','), 'whatsapp:1');
  const welcome = await get(friend, opened.location ?? '/invite');
  check('the welcome says who invited them', welcome.status === 200 && /invited you to GoldPlus/.test(welcome.body), true);
  check('it offers one button to join', welcome.body.includes('data-invite-join'), true);
  const register = await get(friend, '/register');
  check('the sign-up form is filled in from the link', register.body.includes(`value="${code}"`), true);

  // The friend clears the field (as a Google sign-up would never send it): the remembered invite still counts.
  const joined = await signUp(friend, 'friend-e2e@goldplus.test', '0700000982', '');
  check('the friend signs up', joined.status, 303);
  const next = await get(friend, joined.location ?? '/account');
  check('the next page says the invite is on their account', next.body.includes('data-invite-note') && /Your friend(?:'|&#39;|&#x27;)s invite is on your account/.test(next.body), true);
  check('the remembered invite is then forgotten', friend.has('gp_ref'), false);
  const ref = rowsOf(await db.execute(sql`select r.status, r.source from loyalty_referrals r join users u on u.id = r.referee_user_id where u.email = 'friend-e2e@goldplus.test'`))[0];
  check('one pending referral, from the link', `${ref?.status}/${ref?.source}`, 'pending/link');
  const card = await get(referrer, '/account/rewards');
  check('the referrer sees the friend joined', card.body.includes('Joined. Waiting for their first order'), true);

  console.log('\n--- 17. a wrong code is explained, and a code can be added later');
  const typo = new Jar();
  const t = await signUp(typo, 'typo-e2e@goldplus.test', '0700000983', 'GP NOPE99');
  const afterTypo = await get(typo, t.location ?? '/account');
  check('a code that does not exist is explained on the next page', /invite code was not found/.test(afterTypo.body), true);
  const added = await postForm(typo, '/account/invite-code', { code: code.toLowerCase(), returnTo: '/account/rewards' });
  check('adding the right code later redirects back to the card', added.status === 303 && (added.location ?? '').startsWith('/account/rewards'), true);
  const afterAdd = await get(typo, '/account/rewards');
  check('and says it is on their account', afterAdd.body.includes('data-invite-note') && /Your friend(?:'|&#39;|&#x27;)s invite is on your account/.test(afterAdd.body), true);
  const own = await postForm(referrer, '/account/invite-code', { code, returnTo: '/account/rewards' });
  const afterOwn = await get(referrer, own.location ?? '/account/rewards');
  check('their own code is refused, with the reason', /your own invite code/.test(afterOwn.body), true);
  if (!hadConfig) await db.execute(sql`delete from loyalty_config`);
}

// ---------------------------------------------------------------------------
// 0199: a customer buys a gift card for someone else: the real form, Pesapal (stub), the return leg
// ---------------------------------------------------------------------------

async function purchaseByBuyer(phone: string): Promise<Record<string, any> | undefined> {
  return rowsOf(await db.execute(sql`select * from gift_card_purchases where buyer_phone = ${phone} order by created_at desc limit 1`))[0];
}

async function giftCardPurchaseProofs(): Promise<void> {
  const buyerPhone = '0700000911';
  const buyerE164 = '+256700000911';
  const giftForm = {
    amountPreset: 'other', amountOther: '75,000', theme: 'birthday', recipientName: 'Sarah Nakato', recipientPhone: '0772 000912', when: 'now',
    deliverOn: '', message: 'Happy birthday, Sarah!', buyerName: 'Rob Harness', buyerPhone,
  };

  // -- 15. A mistake keeps everything typed; nothing is charged ----------------
  console.log('\n--- 15. a mistake on the gift card form keeps what was typed and charges nothing');
  await resetStub();
  const jar = new Jar();
  const buyPage = await get(jar, '/gift-card/buy');
  check('the buy page opens', buyPage.status, 200);
  // Phone-first: one name (yours is the card's From), no email, the amount on the pay button.
  check('the form asks only what it needs (no separate From, no email)', [/name="fromName"/.test(buyPage.body), /name="buyerEmail"/.test(buyPage.body)], [false, false]);
  check('the pay button carries the amount', /Pay UGX\s50,000/.test(buyPage.body), true);
  // Occasions: the first six by the calendar, every other one a tap away (View all occasions).
  const firstSix = (html: string) => [...(html.split('data-occasions-first')[1] ?? '').split('data-occasions-more')[0].matchAll(/data-occasion="([a-z_]+)"/g)].map((m) => m[1]);
  const allOccasions = (html: string) => [...html.matchAll(/name="theme" value="([a-z_]+)"/g)].map((m) => m[1]).sort();
  check('"Choose an occasion" with "View all occasions"', /Choose an occasion/.test(buyPage.body) && /View all occasions/.test(buyPage.body), true);
  const xmasDay = await get(new Jar(), '/gift-card/buy?on=2026-12-25');
  check('on Christmas Day: Christmas (Today) and New Year first, then A gift for you and Birthday', firstSix(xmasDay.body), ['christmas', 'new_year', 'gold', 'birthday', 'thanks', 'celebrate']);
  check('…labelled from the dates', /Today<\/span>/.test(xmasDay.body) && /Coming up<\/span>/.test(xmasDay.body), true);
  const plainDay = await get(new Jar(), '/gift-card/buy?on=2026-10-21');
  check('on an ordinary day (21 October): the everyday six', firstSix(plainDay.body), ['gold', 'birthday', 'thanks', 'celebrate', 'love', 'anniversary']);
  check('every one of the 14 occasions is selectable on both days', [allOccasions(xmasDay.body).length, allOccasions(plainDay.body).length, new Set(allOccasions(xmasDay.body)).size], [14, 14, 14]);
  const outOfSeason = await get(new Jar(), '/gift-card/buy?theme=valentine&on=2026-10-21');
  check('a chosen out-of-season occasion is shown beside the six, marked "Your choice", and still selected', /data-occasion="valentine"[^>]*>\s*<input[^>]*value="valentine" checked[\s\S]{0,4000}?>Valentine[^<]*<\/span>[\s\S]{0,400}?Your choice<\/span>/.test(outOfSeason.body.split('data-occasions-more')[0]), true);
  const wrong = await postForm(jar, '/gift-card/buy', { ...giftForm, message: 'Send 50,000 to 0772 123 456 now' });
  check('the page comes back (no payment redirect)', wrong.status, 200);
  check('it says why, next to the message', /cannot carry links, web addresses or phone numbers/.test(wrong.body), true);
  check('the name typed is still there', wrong.body.includes('Sarah Nakato'), true);
  check('Pesapal was never contacted', (await stubSubmissions()).length, 0);

  // -- 16. Paid: the card is made, its code texted to them, the buyer receipted --
  console.log('\n--- 16. buying a gift card: pay on Pesapal, the code is texted to them, the buyer gets a receipt');
  const buy = await postForm(jar, '/gift-card/buy', giftForm);
  if (buy.status !== 303) note(`unexpected status ${buy.status}; body excerpt: ${excerptError(buy.body)}`);
  check('the buyer is sent to the payment page', buy.status === 303 && (buy.location ?? '').startsWith(STUB), true);
  const subs = (await stubSubmissions()) as Array<{ merchantReference: string; orderTrackingId: string; amount?: number }>;
  check('one Pesapal transaction, under a GC- reference, for the card value', subs.map((x) => [/^GC-[0-9A-Z]{10}$/.test(x.merchantReference), Number(x.amount)]), [[true, 75_000]]);
  const ref = subs[0]?.merchantReference ?? '';
  check('no order was created for it', rowsOf(await db.execute(sql`select 1 from orders where customer_phone in (${buyerPhone}, ${buyerE164})`)).length, 0);
  check('the purchase waits for the money', (await purchaseByBuyer(buyerE164))?.status, 'awaiting_payment');

  await fetch(`${STUB}/__stub/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderTrackingId: subs[0]?.orderTrackingId, status: 'COMPLETED' }) });
  const back = await fetch(`${process.env.E2E_API_BASE}/commerce/payments/pesapal/callback?OrderTrackingId=${encodeURIComponent(subs[0]?.orderTrackingId ?? '')}&OrderMerchantReference=${encodeURIComponent(ref)}`, { redirect: 'manual' });
  check('Pesapal returns the buyer to the gift card page', (back.headers.get('location') ?? '').endsWith(`/gift-card/bought?ref=${ref}`), true);
  const bought = await purchaseByBuyer(buyerE164);
  check('the purchase is issued', bought?.status, 'issued');
  const [card] = rowsOf(await db.execute(sql`select kind, status, initial_value_ugx, recipient_phone, (select coalesce(sum(amount_ugx), 0) from credit_ledger where instrument_id = i.id) as bal from credit_instruments i where id = ${bought?.instrument_id ?? null}`));
  check('a spendable gift card of 75,000 exists for their number', card ? [card.kind, card.status, Number(card.initial_value_ugx), Number(card.bal), card.recipient_phone] : null, ['gift_card', 'active', 75_000, 75_000, '+256772000912']);
  const texts = rowsOf(await db.execute(sql`select template, coalesce(payload->>'customerPhone', (payload #>> '{}')::jsonb->>'customerPhone') as phone,
      coalesce(payload->>'message', (payload #>> '{}')::jsonb->>'message') as m from outbox_events where idempotency_key in (${`gift-card-paid:${bought?.id}`}, ${`gift-card-received:${bought?.id}`}) order by template`));
  check('two texts: the buyer’s receipt and the code to them', texts.map((t) => [t.template, t.phone]), [['GIFT_CARD_PAID', buyerE164], ['GIFT_CARD_RECEIVED', '+256772000912']]);
  check('the receipt never carries a code', /GPGC/.test(String(texts[0]?.m ?? '')), false);
  const coded = /Rob Harness sent you a gift card of UGX 75,000, with a note for you on the card\. Open it: \S+\/gift-card\/open#GPGC-\S+ Code: GPGC-|Gift card \/ store credit code \(removed once handled\)/.test(String(texts[1]?.m ?? ''));
  check('their text names who it is from, says a note waits on the card, and has the link and the code (or it was sent and scrubbed)', coded, true);
  check('the note itself is not in the text (it is on the card, in full)', /Happy birthday, Sarah/.test(String(texts[1]?.m ?? '')), false);
  const [codeRow] = rowsOf(await db.execute(sql`select coalesce(payload->>'creditCode', (payload #>> '{}')::jsonb->>'creditCode') as code from outbox_events where idempotency_key = ${`gift-card-received:${bought?.id}`}`));
  if (codeRow?.code) {
    // What their phone does with the link: the page posts the code from the #fragment and shows the card to scratch.
    const openJar = new Jar();
    check('the open page loads', (await get(openJar, '/gift-card/open')).status, 200);
    // A real browser sends `Origin: null` on a page served no-referrer, and the cross-site guard then refuses the
    // page's own form: the auto-open from the text's link failed exactly so in Chrome before this check existed.
    const policy = (await fetch(`${WEB}/gift-card/open`, { redirect: 'manual' })).headers.get('referrer-policy') ?? '';
    check('the open page keeps the Origin a browser sends on its own form (not no-referrer)', /no-referrer(?!-)/.test(policy) && !/when/.test(policy), false);
    const opened = await postForm(openJar, '/gift-card/open', { code: String(codeRow.code) });
    check('it opens their card: the birthday design, from Rob, for Sarah, with the message', /data-theme="birthday"[\s\S]*Sarah Nakato[\s\S]*Happy birthday, Sarah![\s\S]*Rob/.test(opened.body), true);
    check('with the code under a scratch panel', opened.body.includes('data-scratch-canvas') && opened.body.includes(String(codeRow.code)), true);
    check('and UGX 75,000 ready to spend', /UGX\s75,000<\/strong> ready to spend/.test(opened.body), true);
    const wrongCode = await postForm(openJar, '/gift-card/open', { code: 'GPGC-AAAA-BBBB-CCCC' });
    check('a wrong code opens nothing', /That code is not right/.test(wrongCode.body) && !wrongCode.body.includes('data-scratch-canvas'), true);
  } else {
    note('the code was already sent and scrubbed from the outbox; the open page is proved by the unit suite');
  }
  const page = await get(jar, `/gift-card/bought?ref=${encodeURIComponent(ref)}`);
  check('the buyer’s page says it is paid and where the text stands (no sender runs here: queued), number masked', /Thank you, it is paid[\s\S]*(Sarah has been texted, on 07••\s•••\s912, a link to open the card|being texted to Sarah on 07••\s•••\s912)/.test(page.body), true);
  const ipn = await fetch(`${process.env.E2E_API_BASE}/commerce/payments/pesapal/ipn?OrderTrackingId=${encodeURIComponent(subs[0]?.orderTrackingId ?? '')}&OrderMerchantReference=${encodeURIComponent(ref)}&OrderNotificationType=IPNCHANGE`);
  check('the IPN that follows is acknowledged', ipn.status, 200);
  check('and makes no second card', rowsOf(await db.execute(sql`select 1 from credit_instruments where reason like ${`%${ref}%`}`)).length, 1);

  // -- 17. Scheduled: paid now, texted on its morning ------------------------------
  console.log('\n--- 17. a card for a later day is paid now and not texted until that morning');
  await resetStub();
  const later = new Date(Date.now() + 3 * 3_600_000 + 5 * 86_400_000).toISOString().slice(0, 10);
  const schedJar = new Jar();
  const sched = await postForm(schedJar, '/gift-card/buy', { ...giftForm, buyerPhone: '0700000913', when: 'date', deliverOn: later });
  check('the buyer is sent to pay', sched.status, 303);
  const s2 = (await stubSubmissions()) as Array<{ merchantReference: string; orderTrackingId: string }>;
  await fetch(`${STUB}/__stub/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderTrackingId: s2[0]?.orderTrackingId, status: 'COMPLETED' }) });
  await fetch(`${process.env.E2E_API_BASE}/commerce/payments/pesapal/ipn?OrderTrackingId=${encodeURIComponent(s2[0]?.orderTrackingId ?? '')}&OrderMerchantReference=${encodeURIComponent(s2[0]?.merchantReference ?? '')}&OrderNotificationType=IPNCHANGE`);
  const p2 = await purchaseByBuyer('+256700000913');
  check('it is paid, with no card yet', [p2?.status, p2?.instrument_id ?? null], ['paid', null]);
  const t2 = rowsOf(await db.execute(sql`select template from outbox_events where idempotency_key like ${`gift-card-%:${p2?.id}`}`)).map((r) => r.template);
  check('only the buyer’s receipt is queued', t2, ['GIFT_CARD_PAID']);

  // -- 18. "Send the code to me instead": no recipient number needed ----------------
  console.log('\n--- 18. a buyer who gives the card in person needs no number for the recipient');
  await resetStub();
  const meJar = new Jar();
  const me = await postForm(meJar, '/gift-card/buy', { ...giftForm, theme: 'eid', recipientPhone: '', sendToMe: '1', buyerPhone: '0700000914' });
  check('they are sent to pay', me.status, 303);
  const meRow = await purchaseByBuyer('+256700000914');
  check('the code will come to the buyer, on the Eid card chosen out of season', [meRow?.send_to, meRow?.recipient_phone ?? null, meRow?.from_name, meRow?.theme], ['buyer', null, 'Rob Harness', 'eid']);

  // -- 19. A photo on the card (0201) -------------------------------------------------
  console.log('\n--- 19. a photo on the card: re-encoded without its metadata, claimed once, shown to them and the buyer');
  await resetStub();
  const sharp = createRequire(new URL('../../apps/api/package.json', import.meta.url))('sharp') as (typeof import('sharp'))['default'];
  const camera = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 150, g: 204, b: 6 } } })
    .jpeg().withExif({ IFD0: { ImageDescription: 'harness-secret-location', Make: 'HarnessCam' } }).toBuffer();
  check('the test photo carries metadata to strip', camera.includes(Buffer.from('harness-secret-location')), true);
  const up = await fetch(`${WEB}/gift-card/photo`, { method: 'POST', headers: { 'content-type': 'image/jpeg', origin: WEB }, body: camera });
  const upJson: any = await up.json().catch(() => null);
  const photoId = String(upJson?.data?.photoId ?? '');
  check('the shop takes the photo through its own address', [up.status, /^[0-9a-f-]{36}$/.test(photoId)], [200, true]);
  const served = await fetch(`${WEB}/gift-card/photo/${photoId}`);
  const servedBytes = Buffer.from(await served.arrayBuffer());
  const servedMeta = await sharp(servedBytes).metadata();
  check('it is served as a square JPEG of at most 1080 px, not indexed', [served.status, served.headers.get('content-type'), servedMeta.width, servedMeta.height, served.headers.get('x-robots-tag')], [200, 'image/jpeg', 1080, 1080, 'noindex']);
  check('with every piece of metadata gone (no camera, no location)', [servedMeta.exif ?? null, servedBytes.includes(Buffer.from('harness-secret-location')), servedBytes.includes(Buffer.from('HarnessCam'))], [null, false, false]);
  const notPhoto = await fetch(`${WEB}/gift-card/photo`, { method: 'POST', headers: { 'content-type': 'image/jpeg', origin: WEB }, body: Buffer.from('<?php echo 1; ?>') });
  check('something that is not a photo is refused', notPhoto.status, 400);
  const photoJar = new Jar();
  const withPhoto = await postForm(photoJar, '/gift-card/buy', { ...giftForm, buyerPhone: '0700000915', photoId, theme: 'love' });
  check('the buyer is sent to pay', withPhoto.status, 303);
  const pRow = await purchaseByBuyer('+256700000915');
  check('the purchase holds the photo', pRow?.photo_id, photoId);
  const reuse = await postForm(new Jar(), '/gift-card/buy', { ...giftForm, buyerPhone: '0700000916', photoId });
  check('another buyer cannot put the same photo on their card: the form says so, nothing is charged', [reuse.status, /Your photo can no longer be used/.test(reuse.body), (await stubSubmissions()).length], [200, true, 1]);
  const s3 = (await stubSubmissions()) as Array<{ merchantReference: string; orderTrackingId: string }>;
  await fetch(`${STUB}/__stub/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderTrackingId: s3[0]?.orderTrackingId, status: 'COMPLETED' }) });
  await fetch(`${process.env.E2E_API_BASE}/commerce/payments/pesapal/ipn?OrderTrackingId=${encodeURIComponent(s3[0]?.orderTrackingId ?? '')}&OrderMerchantReference=${encodeURIComponent(s3[0]?.merchantReference ?? '')}&OrderNotificationType=IPNCHANGE`);
  const boughtPhoto = await get(photoJar, `/gift-card/bought?ref=${encodeURIComponent(s3[0]?.merchantReference ?? '')}`);
  check('the buyer’s page shows the card with the photo', boughtPhoto.body.includes(`/gift-card/photo/${photoId}`) && /gcf-has-photo/.test(boughtPhoto.body), true);
  const p3 = await purchaseByBuyer('+256700000915');
  const [code3] = rowsOf(await db.execute(sql`select coalesce(payload->>'creditCode', (payload #>> '{}')::jsonb->>'creditCode') as code from outbox_events where idempotency_key = ${`gift-card-received:${p3?.id}`}`));
  if (code3?.code) {
    const opened3 = await postForm(new Jar(), '/gift-card/open', { code: String(code3.code) });
    check('their card shows the photo, and the share panel offers it (off until chosen)', [opened3.body.includes(`/gift-card/photo/${photoId}`), /data-share-opt="photo"/.test(opened3.body), /data-share-opt="photo" checked/.test(opened3.body)], [true, true, false]);
  } else note('the code was already sent and scrubbed; the open page with a photo is proved by the unit suite');
  if (E2E_GIFT_PHOTO_OUT) writeFileSync(E2E_GIFT_PHOTO_OUT, JSON.stringify({ code: code3?.code ?? null, reference: s3[0]?.merchantReference ?? null, photoId }));

  // A payment that fails, then the same buyer tries again with the draft's photo: the new purchase carries a copy.
  await resetStub();
  const upRetry = await fetch(`${WEB}/gift-card/photo`, { method: 'POST', headers: { 'content-type': 'image/jpeg', origin: WEB }, body: camera });
  const retryPhoto = String(((await upRetry.json().catch(() => null)) as any)?.data?.photoId ?? '');
  const retryJar = new Jar();
  check('a card with a photo goes to pay', (await postForm(retryJar, '/gift-card/buy', { ...giftForm, buyerPhone: '0700000918', photoId: retryPhoto })).status, 303);
  const s5 = (await stubSubmissions()) as Array<{ merchantReference: string; orderTrackingId: string }>;
  await fetch(`${STUB}/__stub/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderTrackingId: s5[0]?.orderTrackingId, status: 'FAILED' }) });
  await fetch(`${process.env.E2E_API_BASE}/commerce/payments/pesapal/ipn?OrderTrackingId=${encodeURIComponent(s5[0]?.orderTrackingId ?? '')}&OrderMerchantReference=${encodeURIComponent(s5[0]?.merchantReference ?? '')}&OrderNotificationType=IPNCHANGE`);
  check('…the payment fails', (await purchaseByBuyer('+256700000918'))?.status, 'failed');
  const again = await postForm(retryJar, '/gift-card/buy', { ...giftForm, buyerPhone: '0700 000 918', photoId: retryPhoto });
  const retried = await purchaseByBuyer('+256700000918');
  check('…and trying again with the same photo works: the new purchase carries its own copy, the failed one keeps its own',
    [again.status, Boolean(retried?.photo_id), retried?.photo_id !== retryPhoto, rowsOf(await db.execute(sql`select 1 from gift_card_purchases where photo_id = ${retryPhoto}`)).length], [303, true, true, 1]);

  // The person it is for can take the photo off their card (the code is the proof); the buyer can too (the reference).
  if (code3?.code) {
    const removed = await postForm(new Jar(), '/gift-card/open', { intent: 'remove-photo', code: String(code3.code) });
    check('the person it is for removes the photo from their card, and sees the card without it',
      [removed.status, /The photo is removed/.test(removed.body), removed.body.includes(`/gift-card/photo/${photoId}`)], [200, true, false]);
    check('the photo is gone from the shop', (await fetch(`${WEB}/gift-card/photo/${photoId}`)).status, 404);
  }
  await resetStub();
  const up2 = await fetch(`${WEB}/gift-card/photo`, { method: 'POST', headers: { 'content-type': 'image/jpeg', origin: WEB }, body: camera });
  const photo2 = String(((await up2.json().catch(() => null)) as any)?.data?.photoId ?? '');
  const buyer2 = new Jar();
  check('a second card with a photo is bought', (await postForm(buyer2, '/gift-card/buy', { ...giftForm, buyerPhone: '0700000917', photoId: photo2 })).status, 303);
  const s4 = (await stubSubmissions()) as Array<{ merchantReference: string; orderTrackingId: string }>;
  const ref4 = s4[0]?.merchantReference ?? '';
  await fetch(`${STUB}/__stub/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderTrackingId: s4[0]?.orderTrackingId, status: 'COMPLETED' }) });
  await fetch(`${process.env.E2E_API_BASE}/commerce/payments/pesapal/ipn?OrderTrackingId=${encodeURIComponent(s4[0]?.orderTrackingId ?? '')}&OrderMerchantReference=${encodeURIComponent(ref4)}&OrderNotificationType=IPNCHANGE`);
  const buyerRemove = await postForm(buyer2, `/gift-card/bought?ref=${encodeURIComponent(ref4)}`, { intent: 'remove-photo' });
  check('the buyer removes it from their page (and a refresh cannot repeat it: post, redirect, get)', [buyerRemove.status, (buyerRemove.location ?? '').endsWith(`ref=${ref4}&photo=removed`)], [303, true]);
  const after = await get(buyer2, buyerRemove.location ?? `/gift-card/bought?ref=${encodeURIComponent(ref4)}`); // where the browser lands
  check('…the page then says so, the card has no photo, and the purchase keeps everything else', [/The photo is removed/.test(after.body), after.body.includes(`/gift-card/photo/${photo2}`), (await purchaseByBuyer('+256700000917'))?.photo_id ?? null, (await purchaseByBuyer('+256700000917'))?.status], [true, false, null, 'issued']);
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
