/**
 * Does a real checkout write a delivery capture row?
 *
 * PART 1 of the finish brief: a test calling a function does not make it wired.
 * This drives the REAL `CheckoutUseCase` through the REAL Registry against a
 * restored clone, and reports what landed in `delivery_quote_capture` —
 * including which path priced it.
 *
 * CLONE ONLY. It creates an order, so it refuses to run against a database
 * whose name does not say "clone".
 */
import '../config/env';
import { sql } from 'drizzle-orm';
import { db } from '../infrastructure/db/client';
import { Registry } from '../infrastructure/Registry';

async function main() {
  const [{ name }] = (await db.execute(sql`select current_database() as name`)) as unknown as Array<{ name: string }>;
  if (!/clone|test|rehears/i.test(name)) {
    console.error(`CHECKOUT_PROOF_REFUSED database "${name}" is not a clone. This creates an order and will not run against production.`);
    process.exit(1);
  }
  console.log(`\n=== database: ${name} ===`);

  const products = (await db.execute(sql`
    select id, name, price_ugx, shipping_class from products
    where is_active = true and price_ugx > 0 order by created_at desc limit 1`)) as unknown as Array<{
    id: string;
    name: string;
    price_ugx: number;
    shipping_class: string | null;
  }>;
  if (!products[0]) {
    console.error('CHECKOUT_PROOF_FAILED no active priced product to buy.');
    process.exit(1);
  }
  const product = products[0];
  console.log(`  buying: ${product.name} at ${product.price_ugx} (shipping_class=${product.shipping_class ?? 'unset'})`);

  const registry = Registry.getInstance();
  const district = process.env.PROOF_DISTRICT ?? 'Kampala';
  const areaSlug = process.env.PROOF_AREA_SLUG ?? null;

  const result = await registry.checkoutUseCase.execute({
    items: [{ productId: product.id, quantity: 1 }],
    customerDetails: {
      name: 'Delivery capture proof',
      phone: `+25670${Math.floor(1000000 + (Date.parse(String(product.id.slice(0, 8)).replace(/\D/g, '') || '1') % 8999999))}`.slice(0, 13),
      email: null,
      deliveryArea: areaSlug ? `${areaSlug}` : district,
      deliveryAddress: 'Proof run — not a real address',
      deliveryLocation: areaSlug ? { district, areaSlug } : { district },
    },
    paymentMethod: 'offline',
    clientOrderKey: `capture-proof-${Date.now()}`,
  } as never);

  const orderId = (result as { order: { id: string; orderNumber: string; deliveryFee?: number } }).order.id;
  const orderNumber = (result as { order: { orderNumber: string } }).order.orderNumber;
  console.log(`\n=== order ${orderNumber} placed ===`);

  const capture = (await db.execute(sql`
    select area_slug, corridor, distance_band, quoted_fee_ugx, expected_minutes,
           fulfilment_mode, priced_by, config_version_id, carrier, parcel_class, parcel_count
    from delivery_quote_capture where order_id = ${orderId}`)) as unknown as Array<Record<string, unknown>>;

  const [order] = (await db.execute(sql`
    select delivery_fee, delivery_fee_confirmed, total_amount from orders where id = ${orderId}`)) as unknown as Array<Record<string, unknown>>;

  console.log(`  order delivery_fee = ${order.delivery_fee}, confirmed = ${order.delivery_fee_confirmed}`);
  if (capture.length === 0) {
    console.error('\nCHECKOUT_PROOF_FAILED no capture row was written. The quoting service is NOT wired into checkout.');
    process.exit(1);
  }
  console.log('\n=== capture row ===');
  for (const [k, v] of Object.entries(capture[0])) console.log(`  ${k.padEnd(20)} ${v === null ? '—' : String(v)}`);

  const fallback = await registry.deliveryFallbackRateUseCase.execute();
  console.log(`\n=== fallback rate ===\n  ${fallback.fallbackCount}/${fallback.total} (${fallback.fallbackPct.toFixed(1)}%)`);
  console.log(`  byPath: ${JSON.stringify(fallback.byPath)}`);
  console.log(`  ${fallback.note}`);

  console.log('\nCHECKOUT_PROOF_OK');
  process.exit(0);
}

main().catch((e) => {
  console.error('CHECKOUT_PROOF_FAILED', e);
  process.exit(1);
});
