import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { assistantConversations, careHandoverNotes, careSavedReplies, careTaskNotes, careTasks, careTeamMembers } from '../db/schema/assistant';
import type { CareTaskRow, CareTeamMemberRow, ICareDeskRepository, NewCareTask } from '../../application/ports/ICareDeskRepository';
import type { CareDeskToday, CarePriority, CareStatus, CareTaskKind, OnDuty } from '../../domain/assistant/CareDesk';

type T = typeof careTasks.$inferSelect;
type M = typeof careTeamMembers.$inferSelect;
const task = (r: T): CareTaskRow => ({
  id: r.id, kind: r.kind as CareTaskKind, priority: r.priority as CarePriority, status: r.status as CareStatus, title: r.title, detail: r.detail,
  customerName: r.customerName, customerPhone: r.customerPhone, customerEmail: r.customerEmail, orderNumber: r.orderNumber,
  conversationId: r.conversationId, channel: r.channel, proposedAction: (r.proposedAction as Record<string, unknown> | null) ?? null,
  dueAt: r.dueAt, assignedTo: r.assignedTo, openedBy: r.openedBy, resolvedBy: r.resolvedBy, resolution: r.resolution,
  alertedAt: r.alertedAt, resolvedAt: r.resolvedAt, createdAt: r.createdAt,
});
const member = (r: M): CareTeamMemberRow => ({ id: r.id, name: r.name, roleLabel: r.roleLabel, phone: r.phone, email: r.email, alertSms: r.alertSms, alertEmail: r.alertEmail, alertWhatsapp: r.alertWhatsapp, onDuty: (r.onDuty as OnDuty | null) ?? null, active: r.active });
const rowsOf = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) ? r : (r as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>;
const PRIORITY_ORDER = sql`case ${careTasks.priority} when 'urgent' then 0 when 'high' then 1 else 2 end`;

export class DrizzleCareDeskRepository implements ICareDeskRepository {
  async open(t: NewCareTask): Promise<{ task: CareTaskRow; created: boolean }> {
    if (t.conversationId) {
      const [existing] = await db.select().from(careTasks).where(and(eq(careTasks.conversationId, t.conversationId), eq(careTasks.kind, t.kind), eq(careTasks.status, 'open'))).limit(1);
      if (existing) {
        // The customer said more: keep the newest detail and raise the priority if it went up.
        const rank = (p: string) => (p === 'urgent' ? 0 : p === 'high' ? 1 : 2);
        const set: Record<string, unknown> = {};
        if (t.detail) set.detail = t.detail;
        if (rank(t.priority) < rank(existing.priority)) set.priority = t.priority;
        if (Object.keys(set).length) await db.update(careTasks).set(set).where(eq(careTasks.id, existing.id));
        return { task: task({ ...existing, ...(set as Partial<T>) }), created: false };
      }
    }
    const [row] = await db.insert(careTasks).values({
      kind: t.kind, priority: t.priority, title: t.title, detail: t.detail, customerName: t.customerName, customerPhone: t.customerPhone, customerEmail: t.customerEmail,
      orderNumber: t.orderNumber, conversationId: t.conversationId, channel: t.channel, proposedAction: t.proposedAction as never, dueAt: t.dueAt, openedBy: t.openedBy,
    }).returning();
    return { task: task(row!), created: true };
  }

  async get(id: string) { const [r] = await db.select().from(careTasks).where(eq(careTasks.id, id)).limit(1); return r ? task(r) : null; }

  async list(f: { status?: CareStatus; kind?: CareTaskKind; limit: number }) {
    const where = [f.status ? eq(careTasks.status, f.status) : undefined, f.kind ? eq(careTasks.kind, f.kind) : undefined].filter(Boolean) as ReturnType<typeof eq>[];
    const rows = await db.select().from(careTasks).where(where.length ? and(...where) : undefined)
      .orderBy(...(f.status === 'open' ? [asc(PRIORITY_ORDER), asc(careTasks.createdAt)] : [desc(careTasks.resolvedAt), desc(careTasks.createdAt)])).limit(f.limit);
    return rows.map(task);
  }

  async resolve(id: string, input: { status: 'done' | 'cancelled'; resolvedBy: string; resolution: string | null }) {
    const r = await db.update(careTasks).set({ status: input.status, resolvedBy: /^[0-9a-f-]{36}$/i.test(input.resolvedBy) ? input.resolvedBy : null, resolution: input.resolution, resolvedAt: sql`now()` })
      .where(and(eq(careTasks.id, id), eq(careTasks.status, 'open'))).returning({ id: careTasks.id });
    return r.length > 0;
  }

  async assign(id: string, userId: string | null) {
    const r = await db.update(careTasks).set({ assignedTo: userId }).where(eq(careTasks.id, id)).returning({ id: careTasks.id });
    return r.length > 0;
  }

  async alertsSince(since: Date, phone: string | null) {
    const last9 = (phone ?? '').replace(/\D/g, '').slice(-9);
    const same = last9.length === 9 ? sql`count(*) filter (where right(regexp_replace(coalesce(customer_phone, ''), '\\D', '', 'g'), 9) = ${last9})::int` : sql`0`;
    const [r] = rowsOf(await db.execute(sql`select count(*)::int as shop, ${same} as same_phone from care_tasks where alerted_at >= ${since}`));
    return { shop: Number(r?.shop ?? 0), samePhone: Number(r?.same_phone ?? 0) };
  }

  async purgeClosedBefore(cutoff: Date) {
    const gone = await db.delete(careTasks).where(and(sql`${careTasks.status} <> 'open'`, sql`${careTasks.resolvedAt} < ${cutoff}`)).returning({ id: careTasks.id });
    return gone.length;
  }

  async urgentUntaken(limit: number) {
    const rows = await db.select().from(careTasks).where(and(eq(careTasks.status, 'open'), eq(careTasks.priority, 'urgent'), sql`${careTasks.assignedTo} is null`, sql`${careTasks.escalations} < 2`)).orderBy(asc(careTasks.createdAt)).limit(limit);
    return rows.map((r) => ({ ...task(r), escalations: r.escalations, lastEscalatedAt: r.lastEscalatedAt }));
  }

  async markEscalated(id: string) {
    await db.update(careTasks).set({ escalations: sql`${careTasks.escalations} + 1`, lastEscalatedAt: sql`now()` }).where(eq(careTasks.id, id));
  }

  async markAlerted(id: string) { if (/^[0-9a-f-]{36}$/i.test(id)) await db.update(careTasks).set({ alertedAt: sql`now()` }).where(eq(careTasks.id, id)); }

  async team(activeOnly: boolean) {
    const rows = await db.select().from(careTeamMembers).where(activeOnly ? eq(careTeamMembers.active, true) : undefined).orderBy(asc(careTeamMembers.name));
    return rows.map(member);
  }

  async saveMember(m: Omit<CareTeamMemberRow, 'id'> & { id?: string | null }) {
    const values = { name: m.name, roleLabel: m.roleLabel, phone: m.phone, email: m.email, alertSms: m.alertSms, alertEmail: m.alertEmail, alertWhatsapp: m.alertWhatsapp, onDuty: m.onDuty as never, active: m.active };
    if (m.id) {
      const [r] = await db.update(careTeamMembers).set({ ...values, updatedAt: sql`now()` }).where(eq(careTeamMembers.id, m.id)).returning();
      if (r) return member(r);
    }
    const [r] = await db.insert(careTeamMembers).values(values).returning();
    return member(r!);
  }

  async removeMember(id: string) { const r = await db.delete(careTeamMembers).where(eq(careTeamMembers.id, id)).returning({ id: careTeamMembers.id }); return r.length > 0; }

  async staffNumbers() {
    const rows = await db.select({ phone: careTeamMembers.phone }).from(careTeamMembers).where(eq(careTeamMembers.active, true));
    return rows.map((r) => (r.phone ?? '').replace(/\D/g, '')).filter((d) => d.length >= 9).map((d) => (d.startsWith('0') ? `256${d.slice(1)}` : d));
  }

  async today(since: Date): Promise<CareDeskToday> {
    // Open tasks only, so the open-queue partial index (0180) carries it however many tasks are closed.
    const [t] = rowsOf(await db.execute(sql`select
        count(*)::int as open_tasks,
        count(*) filter (where priority = 'urgent')::int as urgent_open,
        count(*) filter (where kind = 'callback')::int as callbacks_open,
        count(*) filter (where kind = 'order_change')::int as approvals_open,
        count(*) filter (where kind = 'bulk_lead')::int as bulk_open,
        min(created_at) as oldest_open
      from care_tasks where status = 'open'`));
    const [c] = rowsOf(await db.execute(sql`select
        count(*)::int as chats,
        count(*) filter (where outcome in ('open', 'resolved'))::int as by_goldie,
        count(*) filter (where outcome in ('needs_human', 'handed_over'))::int as needs_person,
        avg(csat)::float8 as csat_avg,
        count(csat)::int as csat_count
      from assistant_conversations where last_message_at >= ${since}`));
    return {
      openTasks: Number(t?.open_tasks ?? 0), urgentOpen: Number(t?.urgent_open ?? 0), callbacksOpen: Number(t?.callbacks_open ?? 0), approvalsOpen: Number(t?.approvals_open ?? 0), bulkLeadsOpen: Number(t?.bulk_open ?? 0),
      chatsToday: Number(c?.chats ?? 0), handledByGoldieToday: Number(c?.by_goldie ?? 0), needsPersonToday: Number(c?.needs_person ?? 0),
      csatAverage: c?.csat_avg == null ? null : Number(c.csat_avg), csatCount: Number(c?.csat_count ?? 0),
      oldestOpenAt: t?.oldest_open ? new Date(String(t.oldest_open)).toISOString() : null,
    };
  }

  async rate(conversationId: string, score: number, comment: string | null) {
    const r = await db.update(assistantConversations).set({ csat: score, csatComment: comment }).where(eq(assistantConversations.id, conversationId)).returning({ id: assistantConversations.id });
    return r.length > 0;
  }

  async addNote(taskId: string, authorId: string | null, note: string) {
    if (!(await this.get(taskId))) return false;
    await db.insert(careTaskNotes).values({ taskId, authorId: authorId && /^[0-9a-f-]{36}$/i.test(authorId) ? authorId : null, note });
    return true;
  }
  async notesFor(taskIds: string[]) {
    const rows = await db.select().from(careTaskNotes).where(inArray(careTaskNotes.taskId, taskIds)).orderBy(asc(careTaskNotes.createdAt));
    const out: Record<string, Array<{ note: string; createdAt: Date; authorId: string | null }>> = {};
    for (const r of rows) (out[r.taskId] ??= []).push({ note: r.note, createdAt: r.createdAt, authorId: r.authorId });
    return out;
  }
  async savedReplies() { return (await db.select().from(careSavedReplies).orderBy(desc(careSavedReplies.uses), asc(careSavedReplies.title))).map((r) => ({ id: r.id, title: r.title, body: r.body, uses: r.uses })); }
  async saveReply(i: { id?: string | null; title: string; body: string; createdBy: string | null }) {
    if (i.id) { const [r] = await db.update(careSavedReplies).set({ title: i.title, body: i.body, updatedAt: sql`now()` }).where(eq(careSavedReplies.id, i.id)).returning({ id: careSavedReplies.id }); if (r) return { id: r.id }; }
    const [r] = await db.insert(careSavedReplies).values({ title: i.title, body: i.body, createdBy: i.createdBy && /^[0-9a-f-]{36}$/i.test(i.createdBy) ? i.createdBy : null }).returning({ id: careSavedReplies.id });
    return { id: r!.id };
  }
  async removeReply(id: string) { const r = await db.delete(careSavedReplies).where(eq(careSavedReplies.id, id)).returning({ id: careSavedReplies.id }); return r.length > 0; }
  async usedReply(id: string) { await db.update(careSavedReplies).set({ uses: sql`${careSavedReplies.uses} + 1` }).where(eq(careSavedReplies.id, id)); }
  async addHandover(authorId: string | null, note: string) { await db.insert(careHandoverNotes).values({ authorId: authorId && /^[0-9a-f-]{36}$/i.test(authorId) ? authorId : null, note }); }
  async recentHandovers(limit: number) { return (await db.select().from(careHandoverNotes).orderBy(desc(careHandoverNotes.createdAt)).limit(limit)).map((r) => ({ note: r.note, createdAt: r.createdAt, authorId: r.authorId })); }

  async setNextAction(conversationId: string, action: string | null) {
    await db.update(assistantConversations).set({ nextAction: action }).where(eq(assistantConversations.id, conversationId));
  }
}
