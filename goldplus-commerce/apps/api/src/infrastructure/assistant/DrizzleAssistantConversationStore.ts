import { and, desc, eq, gte, lt, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { assistantConversations, assistantMessages } from '../db/schema/assistant';
import type { ArchiveConversationRow, ArchiveFilters, ArchiveMessageRow, IAssistantConversationStore } from '../../application/ports/IAssistantConversationStore';
import { selfServeRate, type ArchiveChannel, type ArchiveMood, type ArchiveOutcome, type ArchiveRole, type MeetingSummary } from '../../domain/assistant/ConversationArchive';

type ConvRow = typeof assistantConversations.$inferSelect;
const toRow = (r: ConvRow): ArchiveConversationRow => ({
  id: r.id, channel: r.channel as ArchiveChannel, channelKey: r.channelKey, customerId: r.customerId, contactName: r.contactName, contactPhone: r.contactPhone, contactEmail: r.contactEmail,
  firstTopic: r.firstTopic, lastTopic: r.lastTopic, worstMood: r.worstMood as ArchiveMood, outcome: r.outcome as ArchiveOutcome, supportTicketId: r.supportTicketId, page: r.page,
  messageCount: r.messageCount, aiTurns: r.aiTurns, humanUntil: r.humanUntil, csat: r.csat ?? null, nextAction: r.nextAction ?? null, startedAt: r.startedAt, lastMessageAt: r.lastMessageAt,
});
const rowsOf = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) ? r : (r as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>;
const clip = (s: string | null | undefined, n: number) => (s ? s.trim().slice(0, n) || null : null);

export class DrizzleAssistantConversationStore implements IAssistantConversationStore {
  async open(input: Parameters<IAssistantConversationStore['open']>[0]): Promise<ArchiveConversationRow> {
    const [row] = await db.insert(assistantConversations).values({
      channel: input.channel, channelKey: input.channelKey, customerId: input.customerId, page: clip(input.page, 500),
      contactName: clip(input.contact?.name, 120), contactPhone: clip(input.contact?.phone, 32), contactEmail: clip(input.contact?.email, 200),
      profileId: input.profileId && /^[0-9a-f-]{36}$/i.test(input.profileId) ? input.profileId : null, visitorKey: clip(input.visitorKey, 200),
    }).onConflictDoUpdate({
      target: [assistantConversations.channel, assistantConversations.channelKey],
      // A known customer or contact fills in; nothing already known is wiped.
      set: {
        customerId: sql`coalesce(${assistantConversations.customerId}, excluded.customer_id)`,
        contactName: sql`coalesce(excluded.contact_name, ${assistantConversations.contactName})`,
        contactPhone: sql`coalesce(excluded.contact_phone, ${assistantConversations.contactPhone})`,
        contactEmail: sql`coalesce(excluded.contact_email, ${assistantConversations.contactEmail})`,
        profileId: sql`coalesce(${assistantConversations.profileId}, excluded.profile_id)`,
        visitorKey: sql`coalesce(${assistantConversations.visitorKey}, excluded.visitor_key)`,
      },
    }).returning();
    return toRow(row!);
  }

  async addMessage(conversationId: string, m: { role: ArchiveRole; content: string; intent?: string | null; mood?: ArchiveMood | null; route?: string | null; channelMessageId?: string | null; cacheId?: string | null }): Promise<boolean> {
    // One round trip: the insert (skipped for a redelivered channel message) and the thread's counter move together.
    const cacheId = m.cacheId && /^[0-9a-f-]{36}$/i.test(m.cacheId) ? m.cacheId : null;
    const rows = rowsOf(await db.execute(sql`
      with ins as (
        insert into assistant_messages (conversation_id, role, content, intent, mood, route, channel_message_id, cache_id)
        values (${conversationId}::uuid, ${m.role}, ${m.content}, ${m.intent ?? null}, ${m.mood ?? null}, ${m.route ?? null}, ${clip(m.channelMessageId, 160)}, ${cacheId}::uuid)
        on conflict do nothing
        returning id
      )
      update assistant_conversations set message_count = message_count + 1, last_message_at = now()
      where id = ${conversationId}::uuid and exists (select 1 from ins)
      returning (select id from ins) as id
    `));
    return rows.length > 0;
  }

  async update(id: string, p: Parameters<IAssistantConversationStore['update']>[1]): Promise<void> {
    const set: Record<string, unknown> = {};
    if (p.lastTopic !== undefined && p.lastTopic !== null) set.lastTopic = p.lastTopic;
    if (p.firstTopic) set.firstTopic = p.firstTopic;
    if (p.worstMood) set.worstMood = p.worstMood;
    if (p.outcome) set.outcome = p.outcome;
    if (p.aiTurn) set.aiTurns = sql`${assistantConversations.aiTurns} + 1`;
    if (p.supportTicketId !== undefined && p.supportTicketId !== null) set.supportTicketId = p.supportTicketId;
    if (p.humanUntil !== undefined) set.humanUntil = p.humanUntil;
    if (p.contact?.name) set.contactName = clip(p.contact.name, 120);
    if (p.contact?.phone) set.contactPhone = clip(p.contact.phone, 32);
    if (p.contact?.email) set.contactEmail = clip(p.contact.email, 200);
    if (!Object.keys(set).length) return;
    await db.update(assistantConversations).set(set).where(eq(assistantConversations.id, id));
  }

  async servedMemory(conversationId: string): Promise<string[]> {
    const rows = await db.selectDistinct({ id: assistantMessages.cacheId }).from(assistantMessages).where(and(eq(assistantMessages.conversationId, conversationId), sql`${assistantMessages.cacheId} is not null`));
    return rows.map((r) => String(r.id));
  }

  async findByKey(channel: ArchiveChannel, channelKey: string): Promise<ArchiveConversationRow | null> {
    const [r] = await db.select().from(assistantConversations).where(and(eq(assistantConversations.channel, channel), eq(assistantConversations.channelKey, channelKey))).limit(1);
    return r ? toRow(r) : null;
  }

  async get(id: string, limit = 500): Promise<{ conversation: ArchiveConversationRow; messages: ArchiveMessageRow[] } | null> {
    const [r] = await db.select().from(assistantConversations).where(eq(assistantConversations.id, id)).limit(1);
    if (!r) return null;
    // The newest `limit` messages, oldest first (a long thread never loads whole for a channel decision).
    const msgs = (await db.select().from(assistantMessages).where(eq(assistantMessages.conversationId, id)).orderBy(desc(assistantMessages.createdAt)).limit(Math.min(Math.max(limit, 1), 500))).reverse();
    return { conversation: toRow(r), messages: msgs.map((m) => ({ id: m.id, role: m.role as ArchiveRole, content: m.content, intent: m.intent, mood: m.mood, route: m.route, createdAt: m.createdAt })) };
  }

  async list(f: ArchiveFilters) {
    const where: SQL[] = [];
    if (f.channel) where.push(eq(assistantConversations.channel, f.channel));
    if (f.outcome) where.push(eq(assistantConversations.outcome, f.outcome));
    if (f.mood) where.push(eq(assistantConversations.worstMood, f.mood));
    if (f.topic) where.push(or(eq(assistantConversations.firstTopic, f.topic), eq(assistantConversations.lastTopic, f.topic))!);
    if (f.from) where.push(gte(assistantConversations.lastMessageAt, f.from));
    if (f.to) where.push(lt(assistantConversations.lastMessageAt, f.to));
    if (f.q) {
      const like = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      // Both halves match a trigram index (0180): the contact expression, and what customers and staff wrote.
      where.push(or(
        sql`(coalesce(${assistantConversations.contactName}, '') || ' ' || coalesce(${assistantConversations.contactPhone}, '') || ' ' || coalesce(${assistantConversations.contactEmail}, '')) ilike ${like}`,
        sql`exists (select 1 from assistant_messages m where m.conversation_id = assistant_conversations.id and m.role in ('customer', 'team') and m.content ilike ${like})`,
      )!);
    }
    const cond = where.length ? and(...where) : undefined;
    // The outer table is named in full: inside a select list Drizzle renders a column unqualified, and a bare "id" in
    // this subquery would bind to the message's own id.
    const lastLine = sql<string>`coalesce((select m.content from assistant_messages m where m.conversation_id = assistant_conversations.id and m.role = 'customer' order by m.created_at desc limit 1), '')`;
    const [rows, count] = await Promise.all([
      db.select({ c: assistantConversations, lastCustomerLine: lastLine }).from(assistantConversations).where(cond).orderBy(desc(assistantConversations.lastMessageAt)).limit(f.limit).offset(f.offset),
      db.select({ n: sql<number>`count(*)::int` }).from(assistantConversations).where(cond),
    ]);
    return { rows: rows.map((r) => ({ ...toRow(r.c), lastCustomerLine: String(r.lastCustomerLine ?? '').slice(0, 240) })), total: Number(count[0]?.n ?? 0) };
  }

  async summary(from: Date, to: Date): Promise<MeetingSummary> {
    const range = sql`last_message_at >= ${from} and last_message_at < ${to}`;
    const [totals, channels, topics, moods, outcomes, follow, ratings, routes] = await Promise.all([
      db.execute(sql`select count(*)::int as conversations,
        coalesce((select count(*)::int from assistant_messages m join assistant_conversations c on c.id = m.conversation_id where m.role = 'customer' and m.created_at >= ${from} and m.created_at < ${to}), 0) as customer_messages
        from assistant_conversations where ${range}`),
      db.execute(sql`select channel as k, count(*)::int as n from assistant_conversations where ${range} group by channel`),
      db.execute(sql`select coalesce(first_topic, 'OTHER') as k, count(*)::int as n from assistant_conversations where ${range} group by 1 order by 2 desc limit 12`),
      db.execute(sql`select worst_mood as k, count(*)::int as n from assistant_conversations where ${range} group by 1`),
      db.execute(sql`select outcome as k, count(*)::int as n from assistant_conversations where ${range} group by 1`),
      db.execute(sql`select c.id, c.channel, coalesce(c.contact_name, c.contact_phone, c.contact_email) as contact, c.last_topic as topic, c.worst_mood as mood, c.last_message_at,
        coalesce((select m.content from assistant_messages m where m.conversation_id = c.id and m.role = 'customer' order by m.created_at desc limit 1), '') as line
        from assistant_conversations c where ${range} and c.outcome in ('needs_human', 'handed_over') order by c.last_message_at desc limit 25`),
      db.execute(sql`select avg(csat)::float8 as avg, count(csat)::int as n from assistant_conversations where ${range}`),
      db.execute(sql`select coalesce(route, 'deterministic') as k, count(*)::int as n from assistant_messages where role = 'goldie' and created_at >= ${from} and created_at < ${to} group by 1`),
    ]);
    // Revenue influenced: paid orders by the same shopper (server profile or account) within 7 days after the chat
    // started. Each order counts once, for the first conversation that preceded it. Influence, not proof of cause.
    const [inf] = rowsOf(await db.execute(sql`
      with convs as (
        select id, started_at, profile_id, customer_id, next_action from assistant_conversations
        where ${range} and (profile_id is not null or customer_id is not null)
      ), hits as (
        select distinct on (o.id) o.id as order_id, o.total_amount, c.id as conversation_id
        from convs c join orders o on (o.profile_id = c.profile_id or o.user_id = c.customer_id)
        where o.created_at >= c.started_at and o.created_at < c.started_at + interval '7 days'
          and o.payment_status = 'paid' and o.status <> 'cancelled'
        order by o.id, c.started_at
      )
      select (select count(*)::int from convs) as linkable,
             (select count(*)::int from hits) as orders,
             (select coalesce(sum(total_amount), 0)::bigint from hits) as revenue,
             (select count(distinct conversation_id)::int from hits) as converting,
             (select count(*)::int from convs where next_action is not null) as with_hint,
             (select count(distinct h.conversation_id)::int from hits h join convs c on c.id = h.conversation_id where c.next_action is not null) as with_hint_converting`));
    const r = rowsOf(ratings)[0] ?? {};
    const map = (r: unknown) => Object.fromEntries(rowsOf(r).map((x) => [String(x.k), Number(x.n)]));
    const t = rowsOf(totals)[0] ?? {};
    const byOutcome = map(outcomes);
    return {
      from: from.toISOString(), to: to.toISOString(),
      conversations: Number(t.conversations ?? 0), customerMessages: Number(t.customer_messages ?? 0),
      byChannel: map(channels), byTopic: rowsOf(topics).map((x) => ({ topic: String(x.k), count: Number(x.n) })), byMood: map(moods), byOutcome,
      selfServeRate: selfServeRate(byOutcome),
      csatAverage: r.avg == null ? null : Number(r.avg), csatCount: Number(r.n ?? 0), byRoute: map(routes),
      influence: {
        linkableConversations: Number(inf?.linkable ?? 0), orders: Number(inf?.orders ?? 0), revenueUgx: Number(inf?.revenue ?? 0),
        conversionRate: Number(inf?.linkable ?? 0) ? Number(inf?.converting ?? 0) / Number(inf.linkable) : null,
        withHint: Number(inf?.with_hint ?? 0),
        hintConversionRate: Number(inf?.with_hint ?? 0) ? Number(inf?.with_hint_converting ?? 0) / Number(inf.with_hint) : null,
      },
      needsFollowUp: rowsOf(follow).map((x) => ({ id: String(x.id), channel: String(x.channel), contact: x.contact ? String(x.contact) : null, topic: x.topic ? String(x.topic) : null, mood: String(x.mood), lastMessageAt: new Date(String(x.last_message_at)).toISOString(), lastCustomerLine: String(x.line ?? '').slice(0, 200) })),
    };
  }

  async pendingWhatsApp(olderThan: Date, newerThan: Date, limit: number) {
    const r = rowsOf(await db.execute(sql`
      select c.id as conversation_id, c.contact_phone, c.contact_name, m.channel_message_id, m.content, m.created_at
      from assistant_conversations c
      join lateral (select role, route, channel_message_id, content, created_at from assistant_messages
                    where conversation_id = c.id order by created_at desc limit 1) m on true
      where c.channel = 'whatsapp' and c.last_message_at > ${newerThan} and c.last_message_at < ${olderThan}
        and m.role = 'customer' and m.route is null and m.channel_message_id is not null
        and (c.human_until is null or c.human_until < now())
      order by c.last_message_at desc limit ${limit}`));
    return r.map((x) => ({ conversationId: String(x.conversation_id), messageId: String(x.channel_message_id), phone: String(x.contact_phone ?? '').replace(/\D/g, ''), name: x.contact_name ? String(x.contact_name) : null, text: String(x.content), at: new Date(String(x.created_at)) }))
      .filter((x) => /^\d{8,15}$/.test(x.phone));
  }

  async claimCustomerMessage(channelMessageId: string) {
    const r = await db.update(assistantMessages).set({ route: 'recovering' }).where(and(eq(assistantMessages.channelMessageId, channelMessageId), sql`${assistantMessages.route} is null`)).returning({ id: assistantMessages.id });
    return r.length > 0;
  }

  async markCustomerMessage(channelMessageId: string, outcome: string) {
    await db.update(assistantMessages).set({ route: outcome.slice(0, 16) }).where(and(eq(assistantMessages.channelMessageId, channelMessageId), eq(assistantMessages.role, 'customer')));
  }

  async purgeBefore(cutoff: Date): Promise<number> {
    const gone = await db.delete(assistantConversations).where(lt(assistantConversations.lastMessageAt, cutoff)).returning({ id: assistantConversations.id });
    return gone.length;
  }
}
