import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { assistantConfig, assistantModelCalls } from '../schema/assistant';
import type { AssistantConfig, Usage } from '../../../domain/assistant/AssistantPolicy';
import type { IAssistantConfigRepository, IAssistantLedgerRepository, LedgerRow, LedgerStatus, MonthTotals } from '../../../application/ports/IAssistantRepository';

const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));
const n = (v: unknown): number => (v == null ? 0 : Number(v));

export class DrizzleAssistantLedgerRepository implements IAssistantLedgerRepository {
  async reserve(input: { month: string; amountMicroUsd: number; killThresholdMicroUsd: number; model: string; principalHash: string; conversationId: string | null; staleAfterMs: number }) {
    return db.transaction(async (tx) => {
      // One month, one lock: concurrent reservations queue here, so two callers
      // can never both fit into the same last cents.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'assistant:' + input.month}))`);
      // A reservation nobody settled is not free money: it becomes UNKNOWN and keeps counting.
      await tx.execute(sql`UPDATE assistant_model_calls SET status = 'UNKNOWN' WHERE month = ${input.month} AND status = 'RESERVED' AND created_at < now() - make_interval(secs => ${input.staleAfterMs / 1000})`);
      const [t] = rowsOf(await tx.execute(sql`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'SETTLED' THEN settled_micro_usd END), 0) AS settled,
          COALESCE(SUM(CASE WHEN status IN ('RESERVED', 'UNKNOWN') THEN reserved_micro_usd END), 0) AS reserved
        FROM assistant_model_calls WHERE month = ${input.month}`));
      const settled = n(t?.settled);
      const committed = settled + n(t?.reserved) + input.amountMicroUsd;
      if (committed > input.killThresholdMicroUsd) return null;
      const [row] = await tx.insert(assistantModelCalls).values({
        month: input.month, status: 'RESERVED', reservedMicroUsd: input.amountMicroUsd, model: input.model,
        principalHash: input.principalHash, conversationId: input.conversationId,
      }).returning({ id: assistantModelCalls.id });
      return row ? { id: row.id, settledBefore: settled } : null;
    });
  }

  async settle(input: { id: string; usage: Usage; costMicroUsd: number; providerRequestId: string | null; outcome: string }) {
    return db.transaction(async (tx) => {
      const [row] = await tx.update(assistantModelCalls)
        .set({
          status: 'SETTLED', settledMicroUsd: input.costMicroUsd, settledAt: new Date(), outcome: input.outcome.slice(0, 40),
          providerRequestId: input.providerRequestId?.slice(0, 120) ?? null,
          inputTokens: input.usage.inputTokens, outputTokens: input.usage.outputTokens,
          cacheReadTokens: input.usage.cacheReadTokens, cacheWriteTokens: input.usage.cacheWriteTokens,
        })
        .where(and(eq(assistantModelCalls.id, input.id), sql`${assistantModelCalls.status} IN ('RESERVED', 'UNKNOWN')`))
        .returning({ month: assistantModelCalls.month });
      if (!row) return null;
      const [t] = rowsOf(await tx.execute(sql`SELECT COALESCE(SUM(settled_micro_usd), 0) AS settled FROM assistant_model_calls WHERE month = ${row.month} AND status = 'SETTLED'`));
      return { settledAfter: n(t?.settled) };
    });
  }

  async release(input: { id: string; reason: string }) {
    const rows = await db.update(assistantModelCalls)
      .set({ status: 'RELEASED', settledMicroUsd: 0, settledAt: new Date(), releaseReason: input.reason.slice(0, 200) })
      .where(and(eq(assistantModelCalls.id, input.id), eq(assistantModelCalls.status, 'RESERVED')))
      .returning({ id: assistantModelCalls.id });
    return rows.length > 0;
  }

  async totals(month: string): Promise<MonthTotals> {
    const rows = rowsOf(await db.execute(sql`
      SELECT status, COUNT(*)::int AS n, COALESCE(SUM(reserved_micro_usd), 0) AS reserved, COALESCE(SUM(settled_micro_usd), 0) AS settled
      FROM assistant_model_calls WHERE month = ${month} GROUP BY status`));
    const counts: Record<LedgerStatus, number> = { RESERVED: 0, SETTLED: 0, RELEASED: 0, UNKNOWN: 0 };
    let settled = 0, reserved = 0;
    for (const r of rows) {
      const s = String(r.status) as LedgerStatus;
      counts[s] = n(r.n);
      if (s === 'SETTLED') settled += n(r.settled);
      if (s === 'RESERVED' || s === 'UNKNOWN') reserved += n(r.reserved);
    }
    const outcomeRows = rowsOf(await db.execute(sql`SELECT outcome, COUNT(*)::int AS n FROM assistant_model_calls WHERE month = ${month} AND outcome IS NOT NULL GROUP BY outcome`));
    const outcomes: Record<string, number> = {};
    for (const r of outcomeRows) outcomes[String(r.outcome)] = n(r.n);
    return { month, settledMicroUsd: settled, reservedMicroUsd: reserved, counts, outcomes };
  }

  async recent(month: string, limit: number): Promise<LedgerRow[]> {
    const rows = await db.select().from(assistantModelCalls).where(eq(assistantModelCalls.month, month)).orderBy(desc(assistantModelCalls.createdAt)).limit(limit);
    return rows.map((r) => ({
      id: r.id, month: r.month, status: r.status as LedgerStatus, reservedMicroUsd: Number(r.reservedMicroUsd), settledMicroUsd: r.settledMicroUsd == null ? null : Number(r.settledMicroUsd),
      model: r.model, principalHash: r.principalHash, conversationId: r.conversationId, outcome: r.outcome, createdAt: r.createdAt, settledAt: r.settledAt,
    }));
  }
}

export class DrizzleAssistantConfigRepository implements IAssistantConfigRepository {
  async get() {
    const [row] = await db.select().from(assistantConfig).where(eq(assistantConfig.id, true)).limit(1);
    return row ? { config: row.config as AssistantConfig, version: row.version } : null;
  }

  async save(config: AssistantConfig, expectedVersion: number, actorId: string) {
    if (expectedVersion === 0) {
      const inserted = await db.insert(assistantConfig).values({ id: true, config: config as never, version: 1, updatedBy: actorId })
        .onConflictDoNothing({ target: assistantConfig.id }).returning({ version: assistantConfig.version });
      if (inserted[0]) return inserted[0];
    }
    const [row] = await db.update(assistantConfig)
      .set({ config: config as never, version: sql`${assistantConfig.version} + 1`, updatedBy: actorId, updatedAt: new Date() })
      .where(and(eq(assistantConfig.id, true), eq(assistantConfig.version, expectedVersion)))
      .returning({ version: assistantConfig.version });
    return row ?? null;
  }
}
