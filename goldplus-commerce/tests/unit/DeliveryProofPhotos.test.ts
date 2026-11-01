import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DeliveryProofPhotoUseCases, DELIVERY_PROOF_PHOTOS_PER_ATTEMPT } from '../../apps/api/src/application/use-cases/fulfilment/DeliveryProofPhotoUseCases';

const TASK = '11111111-1111-4111-8111-111111111111';
const jpeg = { ok: true as const, image: Buffer.from('jpeg'), width: 800, height: 600 };

function setup(o: { delivery?: { id: string; orderId: string } | null; count?: number; processed?: any } = {}) {
  const saved: any[] = [];
  const uc = new DeliveryProofPhotoUseCases({
    latestDelivery: async () => (o.delivery === undefined ? { id: 'd2', orderId: 'o1' } : o.delivery),
    countForDelivery: async () => o.count ?? 0,
    save: async (i) => { saved.push(i); return 'p1'; },
    listForTask: async () => [],
    image: async () => null,
  }, { process: async (_b: Buffer, opts?: { whole?: boolean }) => { expect(opts).toEqual({ whole: true }); return o.processed ?? jpeg; } });
  return { uc, saved };
}

describe('photos as proof of delivery (0212)', () => {
  it('goes on the latest attempt, re-encoded, with who added it', async () => {
    const { uc, saved } = setup();
    expect(await uc.upload({ taskId: TASK, bytes: Buffer.from('x'), actorId: 'staff-1' })).toEqual({ ok: true, photoId: 'p1', deliveryId: 'd2' });
    expect(saved[0]).toMatchObject({ deliveryId: 'd2', orderId: 'o1', uploadedBy: 'staff-1', width: 800, height: 600 });
  });

  it('refuses before an attempt exists, past three, and what is not a photo', async () => {
    expect((await setup({ delivery: null }).uc.upload({ taskId: TASK, bytes: Buffer.from('x'), actorId: 's' }))).toMatchObject({ ok: false, reason: 'no_delivery' });
    expect((await setup({ count: DELIVERY_PROOF_PHOTOS_PER_ATTEMPT }).uc.upload({ taskId: TASK, bytes: Buffer.from('x'), actorId: 's' }))).toMatchObject({ ok: false, reason: 'attempt_full' });
    expect((await setup({ processed: { ok: false, reason: 'not_an_image' } }).uc.upload({ taskId: TASK, bytes: Buffer.from('x'), actorId: 's' }))).toMatchObject({ ok: false, reason: 'not_an_image' });
    expect((await setup().uc.upload({ taskId: TASK, bytes: Buffer.alloc(0), actorId: 's' }))).toMatchObject({ ok: false, reason: 'empty' });
    expect((await setup().uc.upload({ taskId: 'nope', bytes: Buffer.from('x'), actorId: 's' }))).toMatchObject({ ok: false, reason: 'no_delivery' });
  });

  it('is staff-only: served behind ORDERS_READ, never by a public route', () => {
    const admin = readFileSync('apps/api/src/interfaces/http/routes/admin/fulfilment.ts', 'utf8');
    expect(admin).toMatch(/routes\.get\('\/delivery-photos\/:photoId', requirePermissions\(\[PERMISSIONS\.ORDERS_READ\]\)/);
    expect(admin).toMatch(/routes\.post\('\/:id\/delivery\/photos', requirePermissions\(\[PERMISSIONS\.ORDERS_MANAGE\]\)/);
    expect(readFileSync('apps/api/src/interfaces/http/routes/commerce.ts', 'utf8')).not.toContain('deliveryProofPhoto');
    expect(readFileSync('apps/api/src/infrastructure/db/migrations/0212_delivery_proof_photos.sql', 'utf8')).toContain('ON DELETE CASCADE');
  });
});
