import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * jsonb columns written through drizzle must land as OBJECTS. The
 * `${JSON.stringify(v)}::jsonb` cast is encoded twice by postgres-js and stored
 * a jsonb STRING, so `delivery_location->>'district'` read NULL (0160).
 *
 * Set COMMERCE_TEST_DATABASE_URL to a MIGRATED database. Skips otherwise.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('jsonb columns store objects (real PostgreSQL)', () => {
  let db: any;
  let sql: any;
  let eq: any;
  const tag = Date.now().toString(36);

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    ({ db } = await import('../../apps/api/src/infrastructure/db/client'));
    ({ sql, eq } = await import('drizzle-orm'));
  });

  const typeOf = async (query: any) => {
    const r: any = await db.execute(query);
    return (r[0] ?? r.rows?.[0])?.t;
  };

  it('orders.delivery_location (jsonbStrict)', async () => {
    const { orders } = await import('../../apps/api/src/infrastructure/db/schema/commerce');
    const [o] = await db.insert(orders).values({
      orderNumber: `js${tag}`, customerName: 'x', customerPhone: '0', deliveryArea: 'K', deliveryAddress: 'a',
      subtotalAmount: 1, totalAmount: 1, deliveryLocation: { district: 'Wakiso' },
    }).returning({ id: orders.id });
    try {
      expect(await typeOf(sql`select jsonb_typeof(delivery_location) t from orders where id = ${o.id}`)).toBe('object');
      expect(await typeOf(sql`select delivery_location->>'district' t from orders where id = ${o.id}`)).toBe('Wakiso');
    } finally {
      await db.delete(orders).where(eq(orders.id, o.id));
    }
  });

  it('customer_segments.definition (jsonbObject)', async () => {
    const { customerSegments } = await import('../../apps/api/src/infrastructure/db/schema/first-party');
    const key = `js-${tag}`;
    await db.insert(customerSegments).values({ key, name: 'probe', definition: { rules: [{ field: 'x' }] }, createdBy: 't', updatedBy: 't' });
    try {
      expect(await typeOf(sql`select jsonb_typeof(definition) t from customer_segments where key = ${key}`)).toBe('object');
    } finally {
      await db.delete(customerSegments).where(eq(customerSegments.key, key));
    }
  });

  afterAll(async () => {});
});
