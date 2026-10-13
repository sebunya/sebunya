import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { assistantConversations, assistantMessages } from '../db/schema/assistant';
import type { ArchiveConversationRow, ArchiveFilters, ArchiveMessageRow, IAssistantConversationStore } from '../../application/ports/IAssistantConversationStore';
import { selfServeRate, type ArchiveChannel, type ArchiveMood, type ArchiveOutcome, type ArchiveRole, type MeetingSummary } from '../../domain/assistant/ConversationArchive';

type ConvRow = typeof assistantConversations.$inferSelect;
const toRow = (r: ConvRow): ArchiveConversationRow => ({
  id: r.id, channel: r.channel as ArchiveChannel, channelKey: r.channelKey, customerId: r.customerId, contactName: r.contactName, contactPhone: r.contactPhone, contactEmail: r.contactEmail,
  firstTopic: r.firstTopic, lastTopic: r.lastTopic, worstMood: r.worstMood as ArchiveMood, outcome: r.outcome as ArchiveOutcome, supportTicketId: r.supportTicketId, page: r.page,
  messageCount: r.messageCount, aiTurns: r.aiTurns, humanUntil: r.humanUntil, startedAt: r.startedAt, lastMessageAt: r.lastMessageAt,
});
const rowsOf = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) ? r : (r as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>;
const clip = (s: string | null | undefined, n: number) => (s ? s.trim().slice(0, n) || null : null);

export class DrizzleAssistantConversationStore implements IAssistantConversationStore {
  async open(input: Parameters<IAssistantConversationStore['open']>[0]): Promise<ArchiveConversationRow> {
    const [row] = await db.insert(assistantConversations).values({
      channel: input.channel, channelKey: input.channelKey, customerId: input.customerId, page: clip(input.page, 500),
      contactName: clip(input.contact?.name, 120), contactPhone: clip(input.contact?.phone, 32), contactEmail: clip(input.contact?.email, 200),
    }).onConflictDoUpdate({
      target: [assistantConversations.channel, assistantConversations.channelKey],
      // A known customer or contact fills in; nothing already known is wiped.
      set: {
        customerId: sql`coalesce(${assistantConversations.customerId}, excluded.customer_id)`,
        contactName: sql`coalesce(excluded.contact_name, ${assistantConversations.contactName})`,
        contactPhone: sql`coalesce(excluded.contact_phone, ${assistantConversations.contactPhone})`,
        contactEmail: sql`coalesce(excluded.contact_email, ${assistantConversations.contactEmail})`,
      },
    }).returning();
    return toRow(row!);
  }

  async addMessage(conversationId: string, m: { role: ArchiveRole; content: string; intent?: string | null; mood?: ArchiveMood | null; route?: string | null; channelMessageId?: string | null }): Promise<boolean> {
    const inserted = await db.insert(assistantMessages).values({
      conversationId, role: m.role, content: m.content, intent: m.intent ?? null, mood: m.mood ?? null, route: m.route ?? null, channelMessageId: clip(m.channelMessageId, 160),
    }).onConflictDoNothing().returning({ id: assistantMessages.id });
    if (!inserted.length) return false;
    await db.update(assistantConversations).set({ messageCount: sql`${assistantConversations.messageCount} + 1`, lastMessageAt: sql`now()` }).where(eq(assistantConversations.id, conversationId));
    return true;
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

  async findByKey(channel: ArchiveChannel, channelKey: string): Promise<ArchiveConversationRow | null> {
    const [r] = await db.select().from(assistantConversations).where(and(eq(assistantConversations.channel, channel), eq(assistantConversations.channelKey, channelKey))).limit(1);
    return r ? toRow(r) : null;
  }

  async get(id: string): Promise<{ conversation: ArchiveConversationRow; messages: ArchiveMessageRow[] } | null> {
    const [r] = await db.select().from(assistantConversations).where(eq(assistantConversations.id, id)).limit(1);
    if (!r) return null;
    const msgs = await db.select().from(assistantMessages).where(eq(assistantMessages.conversationId, id)).orderBy(assistantMessages.createdAt).limit(500);
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
      where.push(or(
        ilike(assistantConversations.contactName, like), ilike(assistantConversations.contactPhone, like), ilike(assistantConversations.contactEmail, like),
        sql`exists (select 1 from assistant_messages m where m.conversation_id = ${assistantConversations.id} and m.content ilike ${like})`,
      )!);
    }
    const cond = where.length ? and(...where) : undefined;
    const lastLine = sql<string>`coalesce((select m.content from assistant_messages m where m.conversation_id = ${assistantConversations.id} and m.role = 'customer' order by m.created_at desc limit 1), '')`;
    const [rows, count] = await Promise.all([
      db.select({ c: assistantConversations, lastCustomerLine: lastLine }).from(assistantConversations).where(cond).orderBy(desc(assistantConversations.lastMessageAt)).limit(f.limit).offset(f.offset),
      db.select({ n: sql<number>`count(*)::int` }).from(assistantConversations).where(cond),
    ]);
    return { rows: rows.map((r) => ({ ...toRow(r.c), lastCustomerLine: String(r.lastCustomerLine ?? '').slice(0, 240) })), total: Number(count[0]?.n ?? 0) };
  }

  async summary(from: Date, to: Date): Promise<MeetingSummary> {
    const range = sql`last_message_at >= ${from} and last_message_at < ${to}`;
    const [totals, channels, topics, moods, outcomes, follow] = await Promise.all([
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
    ]);
    const map = (r: unknown) => Object.fromEntries(rowsOf(r).map((x) => [String(x.k), Number(x.n)]));
    const t = rowsOf(totals)[0] ?? {};
    const byOutcome = map(outcomes);
    return {
      from: from.toISOString(), to: to.toISOString(),
      conversations: Number(t.conversations ?? 0), customerMessages: Number(t.customer_messages ?? 0),
      byChannel: map(channels), byTopic: rowsOf(topics).map((x) => ({ topic: String(x.k), count: Number(x.n) })), byMood: map(moods), byOutcome,
      selfServeRate: selfServeRate(byOutcome),
      needsFollowUp: rowsOf(follow).map((x) => ({ id: String(x.id), channel: String(x.channel), contact: x.contact ? String(x.contact) : null, topic: x.topic ? String(x.topic) : null, mood: String(x.mood), lastMessageAt: new Date(String(x.last_message_at)).toISOString(), lastCustomerLine: String(x.line ?? '').slice(0, 200) })),
    };
  }

  async purgeBefore(cutoff: Date): Promise<number> {
    const gone = await db.delete(assistantConversations).where(lt(assistantConversations.lastMessageAt, cutoff)).returning({ id: assistantConversations.id });
    return gone.length;
  }
}
