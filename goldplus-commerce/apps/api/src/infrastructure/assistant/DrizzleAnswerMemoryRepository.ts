import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { assistantAnswerMemory } from '../db/schema/assistant';
import type { AnswerMemoryRow, IAnswerMemoryRepository } from '../../application/use-cases/assistant/AnswerMemoryUseCases';
import type { RememberedProduct } from '../../domain/assistant/AnswerMemory';

type R = typeof assistantAnswerMemory.$inferSelect;
const row = (r: R): AnswerMemoryRow => ({
  id: r.id, questionKey: r.questionKey, question: r.question, answer: r.answer, intent: r.intent, products: (r.products as RememberedProduct[]) ?? [],
  pinned: r.pinned, edited: r.edited, retired: r.retired, asks: r.asks, served: r.served, poorRatings: r.poorRatings, staleMisses: r.staleMisses,
  expiresAt: r.expiresAt, lastServedAt: r.lastServedAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
});
const rowsOf = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) ? r : (r as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>;

export class DrizzleAnswerMemoryRepository implements IAnswerMemoryRepository {
  async byKey(key: string) { const [r] = await db.select().from(assistantAnswerMemory).where(eq(assistantAnswerMemory.questionKey, key)).limit(1); return r ? row(r) : null; }

  async remember(i: { key: string; question: string; answer: string; intent: string | null; products: RememberedProduct[]; expiresAt: Date }) {
    await db.insert(assistantAnswerMemory).values({ questionKey: i.key, question: i.question, answer: i.answer, intent: i.intent, products: i.products as never, expiresAt: i.expiresAt })
      .onConflictDoUpdate({
        target: assistantAnswerMemory.questionKey,
        // A pinned or edited answer is the team's: never overwritten by the model. A retired one stays retired.
        set: {
          answer: sql`case when ${assistantAnswerMemory.pinned} or ${assistantAnswerMemory.edited} or ${assistantAnswerMemory.retired} then ${assistantAnswerMemory.answer} else excluded.answer end`,
          products: sql`case when ${assistantAnswerMemory.pinned} or ${assistantAnswerMemory.edited} or ${assistantAnswerMemory.retired} then ${assistantAnswerMemory.products} else excluded.products end`,
          expiresAt: sql`case when ${assistantAnswerMemory.pinned} then ${assistantAnswerMemory.expiresAt} else excluded.expires_at end`,
          staleMisses: sql`case when ${assistantAnswerMemory.pinned} or ${assistantAnswerMemory.edited} then ${assistantAnswerMemory.staleMisses} else 0 end`,
          updatedAt: sql`now()`,
        },
      });
  }

  async countAsk(id: string) { await db.update(assistantAnswerMemory).set({ asks: sql`${assistantAnswerMemory.asks} + 1` }).where(eq(assistantAnswerMemory.id, id)); }
  async served(id: string) { await db.update(assistantAnswerMemory).set({ served: sql`${assistantAnswerMemory.served} + 1`, lastServedAt: sql`now()` }).where(eq(assistantAnswerMemory.id, id)); }
  async stale(id: string) { await db.update(assistantAnswerMemory).set({ staleMisses: sql`${assistantAnswerMemory.staleMisses} + 1` }).where(eq(assistantAnswerMemory.id, id)); }
  async poorRating(ids: string[]) { await db.update(assistantAnswerMemory).set({ poorRatings: sql`${assistantAnswerMemory.poorRatings} + 1` }).where(inArray(assistantAnswerMemory.id, ids)); }

  async list(f: { limit: number; includeRetired: boolean }) {
    const rows = await db.select().from(assistantAnswerMemory).where(f.includeRetired ? undefined : eq(assistantAnswerMemory.retired, false))
      .orderBy(desc(assistantAnswerMemory.pinned), desc(assistantAnswerMemory.asks)).limit(f.limit);
    return rows.map(row);
  }

  async update(id: string, p: { answer?: string; pinned?: boolean; retired?: boolean }) {
    const set: Record<string, unknown> = { updatedAt: sql`now()` };
    if (p.answer !== undefined) { set.answer = p.answer.trim(); set.edited = true; set.poorRatings = 0; }
    if (p.pinned !== undefined) { set.pinned = p.pinned; if (p.pinned) set.retired = false; }
    if (p.retired !== undefined) set.retired = p.retired;
    const r = await db.update(assistantAnswerMemory).set(set).where(eq(assistantAnswerMemory.id, id)).returning({ id: assistantAnswerMemory.id });
    return r.length > 0;
  }

  async remove(id: string) { const r = await db.delete(assistantAnswerMemory).where(eq(assistantAnswerMemory.id, id)).returning({ id: assistantAnswerMemory.id }); return r.length > 0; }

  async routeMix(since: Date) {
    const routes = rowsOf(await db.execute(sql`select coalesce(route, 'deterministic') as k, count(*)::int as n from assistant_messages where role = 'goldie' and created_at >= ${since} group by 1`));
    const [cost] = rowsOf(await db.execute(sql`select coalesce(sum(coalesce(settled_micro_usd, reserved_micro_usd)), 0)::bigint as micro, count(*)::int as calls from assistant_model_calls where created_at >= ${since} and status in ('SETTLED', 'UNKNOWN')`));
    return { byRoute: Object.fromEntries(routes.map((r) => [String(r.k), Number(r.n)])), aiCostMicroUsd: Number(cost?.micro ?? 0), aiCalls: Number(cost?.calls ?? 0) };
  }
}
