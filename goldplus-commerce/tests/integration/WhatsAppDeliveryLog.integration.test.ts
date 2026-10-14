import { describe, expect, it } from 'vitest';

/** The shared WhatsApp delivery log on real Redis: newest first, capped, and readable by a second client (replica). */
const URL = process.env.REDIS_TEST_URL;
const suite = URL ? describe : describe.skip;

suite('WhatsApp delivery log (real Redis)', () => {
  it('two replicas share one list, newest first, capped at 50', async () => {
    const { RedisWhatsAppDeliveryLog } = await import('../../apps/api/src/infrastructure/notifications/whatsapp/WhatsAppDeliveryLog');
    const a = new RedisWhatsAppDeliveryLog(URL), b = new RedisWhatsAppDeliveryLog(URL);
    for (let i = 0; i < 55; i++) await a.record({ at: new Date(Date.now() + i).toISOString(), status: 200, messages: i });
    const seen = await b.recent(60);
    expect(seen).toHaveLength(50);
    expect(seen[0]!.messages).toBe(54);
    expect((await b.recent(3)).map((d) => d.messages)).toEqual([54, 53, 52]);
  });
});
