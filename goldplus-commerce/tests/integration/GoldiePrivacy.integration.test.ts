import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * A customer's Goldie data on a privacy request (Uganda DPPA 2019): the export includes every chat that is
 * theirs (by account, or by the phone or email they gave Goldie, on the website or WhatsApp), the Care Desk
 * tasks about them and what they asked about; erasure removes all of it, and leaves other customers' chats.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('Goldie data in privacy export and erasure (real PostgreSQL)', () => {
  let raw: any; let exporter: any; let eraser: any;
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const phone = `07722${Math.floor(10000 + Math.random() * 89999)}`;
  const email = `goldie-${tag}@e.com`;
  let userId = ''; let requestId = ''; let webConv = ''; let waConv = ''; let otherConv = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 4, prepare: false });
    const repo = await import('../../apps/api/src/infrastructure/first-party/DrizzlePrivacyRepositories');
    const adapters = await import('../../apps/api/src/infrastructure/first-party/FirstPartyAdapters');
    const hasher = new adapters.HmacIdentifierHasher('p'.repeat(40));
    exporter = new repo.DrizzlePersonalDataExporter(hasher); eraser = new repo.DrizzlePersonalDataEraser(hasher);
    const [u] = await raw`insert into users (email, phone, password_hash) values (${email}, ${phone}, 'x') returning id`; userId = u.id;
    [{ id: webConv }] = await raw`insert into assistant_conversations (channel, channel_key, customer_id) values ('web', ${`w-${tag}`}, ${userId}) returning id`;
    // A WhatsApp chat from the same phone, written in international form, with no account link.
    [{ id: waConv }] = await raw`insert into assistant_conversations (channel, channel_key, contact_phone) values ('whatsapp', ${`wa-${tag}`}, ${'+256' + phone.slice(1)}) returning id`;
    [{ id: otherConv }] = await raw`insert into assistant_conversations (channel, channel_key, contact_phone) values ('whatsapp', ${`other-${tag}`}, '+256700000001') returning id`;
    await raw`insert into assistant_messages (conversation_id, role, content) values (${webConv}, 'customer', 'Do you have a 20W charger?'), (${waConv}, 'customer', 'Where is my order?'), (${otherConv}, 'customer', 'someone else')`;
    await raw`insert into care_tasks (kind, title, customer_phone, conversation_id) values ('callback', ${`${tag} call me`}, ${phone}, ${waConv})`;
    await raw`insert into zero_party_signals (fp_client_id, user_id, signal_type, payload, source_component, captured_at) values (${`fp-${tag}`}, ${userId}, 'declared_intent', to_jsonb(${JSON.stringify({ topic: '20W charger' })}::text), 'goldie_chat', now())`;
    await raw`insert into support_issues (subject, description, status, priority, type, metadata) values ('Goldie chat', ${`${tag} handover text long enough`}, 'open', 'medium', 'inquiry', to_jsonb(${JSON.stringify({ source: 'goldie', phone, email: null })}::text))`;
    [{ id: requestId }] = await raw`insert into privacy_requests (reference, user_id, kind) values (${`PRG${tag}`.slice(0, 16)}, ${userId}, 'ANONYMISE_HISTORY') returning id`;
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from assistant_conversations where channel_key like ${'%' + tag}`;
    await raw`delete from care_tasks where title like ${tag + '%'}`;
    await raw`delete from zero_party_signals where fp_client_id = ${`fp-${tag}`}`;
    await raw`delete from support_issues where description like ${tag + '%'} or (subject = 'Goldie chat' and description = 'Removed at the customer''s request')`;
    await raw`delete from privacy_requests where user_id = ${userId}`;
    await raw`delete from users where id = ${userId}`;
    await raw.end();
  });

  it('exports every Goldie chat that is theirs, with messages, tasks and interests', async () => {
    const out = await exporter.collect(userId);
    const chats = out.sections.goldieChats as Array<{ channel: string; messages: Array<{ text: string }> }>;
    expect(chats.map((c) => c.channel).sort()).toEqual(['web', 'whatsapp']);
    expect(chats.flatMap((c) => c.messages.map((m) => m.text))).not.toContain('someone else');
    expect(out.sections.goldieFollowUps).toHaveLength(1);
    expect(out.sections.goldieInterests).toEqual([expect.objectContaining({ topic: '20W charger' })]);
  });

  it('erases them, the guest handover ticket included, and leaves other customers alone', async () => {
    const r = await eraser.erase({ userId, kind: 'ANONYMISE_HISTORY', requestId, actorId: '00000000-0000-0000-0000-000000000000', reason: 'customer request' });
    expect(r.completed).toBe(true);
    expect(r.counts).toMatchObject({ goldieConversations: 2, goldieCareTasks: 1, goldieInterests: 1, goldieHandoverTickets: 1 });
    expect((await raw`select count(*)::int n from assistant_conversations where id in (${webConv}, ${waConv})`)[0].n).toBe(0);
    expect((await raw`select count(*)::int n from assistant_messages where conversation_id in (${webConv}, ${waConv})`)[0].n).toBe(0);
    expect((await raw`select count(*)::int n from assistant_conversations where id = ${otherConv}`)[0].n).toBe(1);
  });
});
