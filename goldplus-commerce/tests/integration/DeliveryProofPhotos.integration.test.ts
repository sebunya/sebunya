import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * 0212 on real PostgreSQL: a proof photo lands on the task's LATEST attempt, lists with its attempt number, reads
 * back byte for byte, and the table's size check refuses an oversized frame.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('delivery proof photos (real PostgreSQL)', () => {
  let raw: any; let repo: any;
  const tag = `dpp${Date.now().toString(36)}`;
  let taskId = ''; let orderId = ''; let first = ''; let second = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    [{ id: orderId }] = await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, total_amount, status, payment_status)
      values (${`GP-${tag}`.slice(0, 20)}, 'T', '070', 'Kla', 'Adr', 1000, 1000, 'delivered', 'paid') returning id`;
    [{ id: taskId }] = await raw`insert into fulfilment_tasks (order_id, order_number, status, payment_status, customer_name, customer_contact_masked, delivery_area, delivery_summary, total_ugx, item_count, items, sla_due_at)
      values (${orderId}, ${`DP${tag}`.slice(0, 20)}, 'DELIVERED', 'paid', 'T', '07****0', 'Kla', 'x', 1000, 1, '[]'::jsonb, now()) returning id`;
    [{ id: first }] = await raw`insert into fulfilment_deliveries (fulfilment_task_id, order_id, attempt, outcome) values (${taskId}, ${orderId}, 1, 'DELIVERY_FAILED') returning id`;
    [{ id: second }] = await raw`insert into fulfilment_deliveries (fulfilment_task_id, order_id, attempt, outcome, delivered_at) values (${taskId}, ${orderId}, 2, 'DELIVERED', now()) returning id`;
    const { DrizzleDeliveryProofPhotoRepository } = await import('../../apps/api/src/infrastructure/fulfilment/DrizzleDeliveryProofPhotoRepository');
    repo = new DrizzleDeliveryProofPhotoRepository();
  });

  afterAll(async () => { if (raw) await raw.end({ timeout: 5 }); });

  it('stores on the latest attempt and reads back', async () => {
    expect(await repo.latestDelivery(taskId)).toEqual({ id: second, orderId });
    const bytes = Buffer.from('fake-jpeg-bytes');
    const id = await repo.save({ deliveryId: second, orderId, uploadedBy: null, image: bytes, width: 800, height: 600 });
    expect(await repo.countForDelivery(second)).toBe(1);
    expect(await repo.countForDelivery(first)).toBe(0);
    expect((await repo.image(id))?.equals(bytes)).toBe(true);
    expect(await repo.listForTask(taskId)).toEqual([expect.objectContaining({ id, deliveryId: second, attempt: 2 })]);
  });

  it('the size check refuses a frame larger than the pipeline makes', async () => {
    await expect(raw`insert into delivery_proof_photos (delivery_id, order_id, image, width, height) values (${second}, ${orderId}, ${Buffer.from('x')}, 4000, 3000)`).rejects.toThrow();
  });
});
