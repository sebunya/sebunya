import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * Goldie's conversation archive (0177) on real PostgreSQL: a thread opens once
 * per channel key, a redelivered WhatsApp message is filed once, the inbox
 * filters and search find it, the meeting summary counts it, and the purge
 * removes only what is past retention (messages go with their thread).
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('Goldie conversation archive (real PostgreSQL)', () => {
  let raw: any;
  let store: import('../../apps/api/src/infrastructure/assistant/DrizzleAssistantConversationStore').DrizzleAssistantConversationStore;
  const tag = `itest-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('postgres')(URL as string, { max: 2, onnotice: () => undefined });
    store = new (await import('../../apps/api/src/infrastructure/assistant/DrizzleAssistantConversationStore')).DrizzleAssistantConversationStore();
  });

  afterAll(async () => {
    await raw`delete from assistant_conversations where channel_key like ${tag + '%'}`;
    await raw.end();
  });

  it('opens one thread per channel key and fills in contact details without wiping them', async () => {
    const a = await store.open({ channel: 'whatsapp', channelKey: `${tag}-wa`, customerId: null, page: null, contact: { name: 'Sarah N', phone: '+256772000111' } });
    const b = await store.open({ channel: 'whatsapp', channelKey: `${tag}-wa`, customerId: null, page: null, contact: { email: 'sarah@example.com' } });
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ contactName: 'Sarah N', contactPhone: '+256772000111', contactEmail: 'sarah@example.com' });
  });

  it('files a redelivered message once and rolls up the thread', async () => {
    const c = await store.open({ channel: 'whatsapp', channelKey: `${tag}-wa`, customerId: null, page: null });
    expect(await store.addMessage(c.id, { role: 'customer', content: 'Where is my order GP-202610-ABCD1234?', intent: 'ORDER', mood: 'worried', channelMessageId: `wamid.${tag}.1` })).toBe(true);
    expect(await store.addMessage(c.id, { role: 'customer', content: 'Where is my order GP-202610-ABCD1234?', channelMessageId: `wamid.${tag}.1` })).toBe(false);
    expect(await store.addMessage(c.id, { role: 'goldie', content: "Let's check on your order for you now.", route: 'deterministic' })).toBe(true);
    await store.update(c.id, { firstTopic: 'ORDER', lastTopic: 'ORDER', worstMood: 'worried', outcome: 'open', aiTurn: false });
    const got = await store.get(c.id);
    expect(got!.messages.map((m) => m.role)).toEqual(['customer', 'goldie']);
    expect(got!.conversation).toMatchObject({ messageCount: 2, firstTopic: 'ORDER', worstMood: 'worried' });
  });

  it('the inbox finds it by words, contact, channel and mood; the summary counts it', async () => {
    const byWords = await store.list({ q: 'ABCD1234', limit: 20, offset: 0 });
    expect(byWords.rows.some((r) => r.channelKey === `${tag}-wa`)).toBe(true);
    expect(byWords.rows.find((r) => r.channelKey === `${tag}-wa`)!.lastCustomerLine).toMatch(/Where is my order/);
    const byPhone = await store.list({ q: '772000111', channel: 'whatsapp', mood: 'worried', limit: 20, offset: 0 });
    expect(byPhone.rows.some((r) => r.channelKey === `${tag}-wa`)).toBe(true);
    const none = await store.list({ q: 'ABCD1234', channel: 'web', limit: 20, offset: 0 });
    expect(none.rows.some((r) => r.channelKey === `${tag}-wa`)).toBe(false);
    const s = await store.summary(new Date(Date.now() - 3600_000), new Date(Date.now() + 60_000));
    expect(s.conversations).toBeGreaterThanOrEqual(1);
    expect(s.byChannel.whatsapp).toBeGreaterThanOrEqual(1);
    expect(s.byTopic.some((t) => t.topic === 'ORDER')).toBe(true);
  });

  it('purges only threads past retention, with their messages', async () => {
    const old = await store.open({ channel: 'web', channelKey: `${tag}-old`, customerId: null, page: '/' });
    await store.addMessage(old.id, { role: 'customer', content: 'old question' });
    await raw`update assistant_conversations set last_message_at = now() - interval '400 days' where id = ${old.id}`;
    const purged = await store.purgeBefore(new Date(Date.now() - 365 * 86400_000));
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await store.get(old.id)).toBeNull();
    expect((await raw`select count(*)::int as n from assistant_messages where conversation_id = ${old.id}`)[0].n).toBe(0);
    expect(await store.findByKey('whatsapp', `${tag}-wa`)).not.toBeNull();
  });
});
