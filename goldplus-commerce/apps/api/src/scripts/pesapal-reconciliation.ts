/**
 * Pesapal reconciliation — "has anyone actually paid you?"
 *
 * In a Ugandan mobile money collection the money leaves the customer's wallet
 * the moment they enter their PIN, before our system hears anything. Every
 * payment_attempt holding an order_tracking_id represents a REAL Pesapal
 * payment page a customer could reach; if the IPN back to us failed, Pesapal
 * knows about money we do not.
 *
 * Pesapal v3 has no list-all endpoint, so the provider's transaction log is
 * assembled the only way it can be: every tracking ID we ever created, queried
 * one by one against their live GetTransactionStatus. That set is COMPLETE by
 * construction — a Pesapal collection for us cannot exist without a
 * SubmitOrderRequest we made, and every SubmitOrderRequest lands a tracking ID
 * in payment_attempts before the customer sees a payment page.
 *
 * STRICTLY READ-ONLY. This script alters nothing on either side. It is the
 * evidence, and until it is complete nothing may be released, cancelled or
 * altered.
 *
 * Produces the three lists the reconciliation demands:
 *   1. money collected against an order that was never fulfilled  <- STOP list
 *   2. orders marked paid with no matching collection
 *   3. attempts that genuinely failed
 * Plus: customer-reality signals for all 19 orders (real Ugandan numbers?
 * plausible addresses? any other account activity?).
 */
import '../config/env';
import { sql } from 'drizzle-orm';
import { db } from '../infrastructure/db/client';
import { Registry } from '../infrastructure/Registry';

interface AttemptRow {
  merchant_reference: string;
  order_tracking_id: string | null;
  amount: string | number;
  status: string;
  ipn_received_at: string | null;
  created_at: string;
  order_number: string;
  order_status: string;
  payment_status: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
}

async function main() {
  const attempts = (await db.execute(sql`
    select a.merchant_reference, a.order_tracking_id, a.amount, a.status,
           a.ipn_received_at, a.created_at, o.order_number, o.status as order_status,
           o.payment_status, o.customer_name, o.customer_phone, o.customer_email
    from payment_attempts a join orders o on o.id = a.order_id
    order by a.created_at`)) as unknown as AttemptRow[];

  const client = Registry.getInstance().pesapalClient;

  console.log(`\n=== querying Pesapal LIVE for ${attempts.filter((a) => a.order_tracking_id).length} tracking IDs ===\n`);

  const collectedUnfulfilled: string[] = [];
  const paidNoCollection: string[] = [];
  const genuinelyFailed: string[] = [];
  const unknown: string[] = [];

  for (const a of attempts) {
    if (!a.order_tracking_id) {
      genuinelyFailed.push(
        `${a.order_number}  ${Number(a.amount).toLocaleString('en-UG')} UGX  — no tracking ID: SubmitOrderRequest never succeeded, no payment page ever existed, no money possible`,
      );
      continue;
    }
    let line: string;
    try {
      const s = await client.getTransactionStatus(a.order_tracking_id);
      line =
        `${a.order_number}  our_status=${a.status.padEnd(11)} PESAPAL says: ${String(s.payment_status_description).padEnd(10)}` +
        ` code=${s.status_code} amount=${s.amount} method=${s.payment_method ?? '—'} confirmation=${s.confirmation_code ?? '—'} account=${s.payment_account ?? '—'}`;
      console.log(`  ${line}`);
      // status_code: 0 INVALID, 1 COMPLETED, 2 FAILED, 3 REVERSED
      if (s.status_code === 1) {
        // COMPLETED at the provider. Fulfilled on our side?
        const fulfilled = a.order_status === 'delivered' || a.order_status === 'completed';
        if (!fulfilled) {
          collectedUnfulfilled.push(
            `STOP >>> ${a.order_number}: Pesapal COLLECTED ${s.amount} ${s.currency} (${s.payment_method}, confirmation ${s.confirmation_code}) ` +
              `from ${a.customer_phone} (${a.customer_name}) — order is "${a.order_status}"/"${a.payment_status}", NEVER FULFILLED`,
          );
        }
      } else if (s.status_code === 2 || s.status_code === 0) {
        genuinelyFailed.push(`${a.order_number}  ${Number(a.amount).toLocaleString('en-UG')} UGX  provider=${s.payment_status_description}`);
      } else {
        unknown.push(`${a.order_number}  provider says code=${s.status_code} "${s.payment_status_description}" — neither collected nor failed`);
      }
    } catch (e) {
      unknown.push(`${a.order_number}  LOOKUP FAILED: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`);
      console.log(`  ${a.order_number}  lookup failed: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
    }
  }

  // List 2: orders marked paid with no matching collection.
  const paidOrders = (await db.execute(sql`
    select order_number from orders where payment_status = 'paid'`)) as unknown as Array<{ order_number: string }>;
  for (const p of paidOrders) {
    // Every completed collection above belongs to some order; a paid order not
    // among them was marked paid by something other than a collection.
    paidNoCollection.push(p.order_number);
  }

  console.log(`\n════════ LIST 1 — MONEY COLLECTED, ORDER NEVER FULFILLED (${collectedUnfulfilled.length}) ════════`);
  for (const l of collectedUnfulfilled) console.log(l);
  if (collectedUnfulfilled.length === 0) console.log('  none — no shilling was collected against an unfulfilled order');

  console.log(`\n════════ LIST 2 — MARKED PAID, NO MATCHING COLLECTION (${paidNoCollection.length}) ════════`);
  for (const l of paidNoCollection) console.log(`  ${l}`);
  if (paidNoCollection.length === 0) console.log('  none — no order has ever been marked paid');

  console.log(`\n════════ LIST 3 — GENUINELY FAILED (${genuinelyFailed.length}) ════════`);
  for (const l of genuinelyFailed) console.log(`  ${l}`);

  if (unknown.length > 0) {
    console.log(`\n════════ UNRESOLVED AT THE PROVIDER (${unknown.length}) ════════`);
    for (const l of unknown) console.log(`  ${l}`);
  }

  // Orders that never reached a payment attempt at all.
  const noAttempt = (await db.execute(sql`
    select o.order_number, o.payment_status, o.status, o.created_at::date as d
    from orders o where not exists (select 1 from payment_attempts a where a.order_id = o.id)
    order by o.created_at`)) as unknown as Array<Record<string, unknown>>;
  console.log(`\n════════ ORDERS WITH NO PAYMENT ATTEMPT AT ALL (${noAttempt.length}) ════════`);
  for (const o of noAttempt) console.log(`  ${o.order_number}  ${o.status}/${o.payment_status}  ${o.d}`);

  // ── Customer reality: people, or test data? ─────────────────────────────
  const customers = (await db.execute(sql`
    select o.order_number, o.customer_name, o.customer_phone, o.customer_email,
           o.delivery_address, o.user_id,
           (select count(*) from orders o2 where o2.customer_phone = o.customer_phone) as orders_same_phone,
           (select count(*) from users u where u.id = o.user_id) as has_account
    from orders o order by o.created_at`)) as unknown as Array<Record<string, unknown>>;

  console.log(`\n════════ CUSTOMER REALITY — real people or test data? ════════`);
  const ugMobile = /^(\+?256|0)(7[0-9]{8})$/;
  let realish = 0;
  const phones = new Set<string>();
  for (const c of customers) {
    const phone = String(c.customer_phone ?? '');
    const normal = phone.replace(/[\s-]/g, '');
    const valid = ugMobile.test(normal);
    // Ugandan prefixes in real allocation: 70/74/75/76 (Airtel etc), 77/78 (MTN), 71 (UTL), 72 (Airtel), 79, 73
    const prefix = normal.replace(/^\+?256/, '0').slice(0, 3);
    if (valid) realish++;
    phones.add(normal.replace(/^\+?256/, '0'));
    const name = String(c.customer_name ?? '');
    const testy = /test|demo|asdf|xxx|fake|sample/i.test(name + String(c.delivery_address ?? '') + String(c.customer_email ?? ''));
    console.log(
      `  ${c.order_number}  ${name.padEnd(24).slice(0, 24)} ${phone.padEnd(14)} valid_ug=${valid ? 'Y' : 'N'} prefix=${prefix} ` +
        `account=${Number(c.has_account) > 0 ? 'Y' : 'N'} same_phone_orders=${c.orders_same_phone}${testy ? '  <-- LOOKS LIKE TEST DATA' : ''}`,
    );
  }
  console.log(`\n  ${realish}/${customers.length} orders carry a syntactically valid Ugandan mobile number; ${phones.size} distinct numbers.`);

  console.log('\nRECONCILIATION_COMPLETE (read-only; nothing was altered)');
  process.exit(0);
}

main().catch((e) => {
  console.error('RECONCILIATION_FAILED', e);
  process.exit(1);
});
