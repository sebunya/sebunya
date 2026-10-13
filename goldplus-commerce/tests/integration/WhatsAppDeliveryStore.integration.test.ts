import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

/**
 * The WhatsApp delivery store on real PostgreSQL: STOP / START on channel_suppressions, the 30-day "not on WhatsApp"
 * skip, and a sent message taken for the SMS fallback exactly once.
 */
const url = process.env.COMMERCE_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const run = url ? describe : describe.skip;

run('WhatsApp delivery store (real PostgreSQL)', () => {
  // postgres is the api's dependency (as in the other integration tests).
  const raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(url!, { max: 1, prepare: false });
  let store: typeof import('../../apps/api/src/infrastructure/notifications/whatsapp/WhatsAppDeliveryStore').whatsAppDeliveryStore;
  const phone = `+2567${String(Date.now()).slice(-8)}`;
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    for (const m of ['0185_whatsapp_sent_messages']) {
      const sqlText = (await import('node:fs')).readFileSync(`apps/api/src/infrastructure/db/migrations/${m}.sql`, 'utf8').replace(/--> statement-breakpoint/g, '').replace(/SET LOCAL[^;]*;/g, '');
      await raw.unsafe(sqlText);
    }
    store = (await import('../../apps/api/src/infrastructure/notifications/whatsapp/WhatsAppDeliveryStore')).whatsAppDeliveryStore;
  });
  afterAll(async () => {
    await raw`delete from channel_suppressions where endpoint_ref = ${`phone:${phone}`}`;
    await raw`delete from whatsapp_sent_messages where recipient = ${phone}`;
    await raw.end();
  });

  it('STOP blocks WhatsApp for the number (once, however often they send it); START lifts it', async () => {
    expect(await store.blockReason(phone)).toBeNull();
    await store.stop(phone, `wamid.stop.${phone}`);
    await store.stop(phone, `wamid.stop2.${phone}`);
    expect(await store.blockReason(phone)).toBe('RECIPIENT_OPTED_OUT');
    const [{ n }] = await raw`select count(*)::int as n from channel_suppressions where endpoint_ref = ${`phone:${phone}`} and suppression_active and channel_key = 'whatsapp'`;
    expect(n).toBe(1);
    await store.start(phone);
    expect(await store.blockReason(phone)).toBeNull();
  });

  it('"not on WhatsApp" skips the number for 30 days, then expires by itself', async () => {
    await store.markNotOnWhatsApp(phone, 'wamid.x');
    expect(await store.blockReason(phone)).toBe('RECIPIENT_NOT_ON_WHATSAPP');
    await raw`update channel_suppressions set expires_at = now() - interval '1 minute' where endpoint_ref = ${`phone:${phone}`} and scope = 'delivery'`;
    expect(await store.blockReason(phone)).toBeNull();
  });

  it('a sent message is taken for the SMS fallback once, and not after 24 hours', async () => {
    const payload = { recipient: phone, template: 'ORDER_DISPATCHED', data: { orderNumber: 'GP-1', customerName: 'Sarah' }, relatedEntity: 'order', relatedEntityId: null };
    await store.rememberSent(`wamid.sent.${phone}`, payload);
    expect(await store.takeForSmsFallback(`wamid.sent.${phone}`)).toMatchObject({ template: 'ORDER_DISPATCHED', data: { orderNumber: 'GP-1' } });
    expect(await store.takeForSmsFallback(`wamid.sent.${phone}`)).toBeNull();
    await store.rememberSent(`wamid.old.${phone}`, payload);
    await raw`update whatsapp_sent_messages set sent_at = now() - interval '25 hours' where message_id = ${`wamid.old.${phone}`}`;
    expect(await store.takeForSmsFallback(`wamid.old.${phone}`)).toBeNull();
  });
});
