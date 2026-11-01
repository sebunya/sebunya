import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { pgJsonb } from '../db/PgParams';
import {
  AUTOMATED_BROWSER_PATTERNS, AUTOMATED_TRAFFIC_CLASSES, ExclusionRule, ExclusionRuleKey, estimateMarkBytes,
} from '../../domain/first-party/TrafficExclusion';

const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));

export interface ExclusionWindow { from: Date | null; to: Date | null }

const notYetMarked = (table: string, id: SQL) => sql`not exists (select 1 from analysis.traffic_exclusion_marks m where m.source_table = ${table} and m.row_id = ${id} and m.reverted_at is null)`;
const likeAny = (col: SQL, patterns: string[]) => sql`(${sql.join(patterns.map((p) => sql`lower(${col}) like ${p}`), sql` or `)})`;
const inList = (col: SQL, values: string[]) => sql`${col} in (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;

/**
 * The candidate rows for one rule, as a `select <id>` over the source table.
 * Every predicate is about WHERE the traffic came from, never about a person.
 */
function candidates(key: ExclusionRuleKey, w: ExclusionWindow): { table: string; select: SQL } {
  const winE = sql`${w.from ? sql`and e.created_at >= ${w.from}` : sql``} ${w.to ? sql`and e.created_at < ${w.to}` : sql``}`;
  const winP = sql`${w.from ? sql`and p.first_seen_at >= ${w.from}` : sql``} ${w.to ? sql`and p.first_seen_at < ${w.to}` : sql``}`;
  switch (key) {
    case 'AUTOMATED_USER_AGENT':
      return {
        table: 'recommendation_events',
        select: sql`select e.id from recommendation_events e where e.browser_family is not null and ${likeAny(sql`e.browser_family`, AUTOMATED_BROWSER_PATTERNS)} ${winE} and ${notYetMarked('recommendation_events', sql`e.id`)}`,
      };
    case 'PROBE_MARKED':
      return {
        table: 'recommendation_events',
        select: sql`select e.id from recommendation_events e where (
            ${inList(sql`lower(coalesce(e.metadata->>'trafficClass', e.metadata->>'traffic_class', ''))`, AUTOMATED_TRAFFIC_CLASSES)}
            or coalesce(e.metadata->>'probe', '') in ('true', '1') or coalesce(e.metadata->>'gp_probe', '') <> ''
          ) ${winE} and ${notYetMarked('recommendation_events', sql`e.id`)}`,
      };
    case 'RESPONSE_WITHOUT_VISITOR':
      return {
        table: 'recommendation_events',
        select: sql`select e.id from recommendation_events e where e.event_type = 'RECOMMENDATION_RESPONSE'
          and e.profile_id is null and e.anonymous_id is null and e.customer_id is null and e.browser_id is null ${winE}
          and ${notYetMarked('recommendation_events', sql`e.id`)}`,
      };
    case 'SINGLE_HIT_PROFILE':
      return {
        table: 'experience_profiles',
        select: sql`select p.id from experience_profiles p where p.customer_id is null
          and p.last_seen_at - p.first_seen_at < interval '1 second' ${winP}
          and not exists (select 1 from orders o where o.profile_id = p.id)
          and not exists (select 1 from recommendation_events e where e.profile_id = p.id and e.event_type not in ('RECOMMENDATION_RESPONSE', 'RECOMMENDATION_ERROR'))
          and ${notYetMarked('experience_profiles', sql`p.id`)}`,
      };
    case 'EVENT_OF_EXCLUDED_PROFILE':
      return {
        table: 'recommendation_events',
        select: sql`select e.id from recommendation_events e
          join analysis.traffic_exclusion_marks pm on pm.source_table = 'experience_profiles' and pm.row_id = e.profile_id and pm.reverted_at is null
          where true ${winE} and ${notYetMarked('recommendation_events', sql`e.id`)}`,
      };
  }
}

export class TrafficExclusionStore {
  /** Dry run: how many rows each rule WOULD mark, and what the marks would cost. */
  async count(rules: ExclusionRule[], w: ExclusionWindow) {
    const out: Array<{ rule: ExclusionRuleKey; table: string; candidates: number; estimatedBytes: number; note?: string }> = [];
    for (const r of rules) {
      const c = candidates(r.key, w);
      const [n] = rows(await db.execute(sql`select count(*)::int as n from (${c.select}) x`));
      const count = Number(n?.n ?? 0);
      // A rule that depends on another rule's marks can only be counted after it applies.
      const note = r.after.length ? `Counted from marks already applied; after ${r.after.join(', ')} runs it will be higher.` : undefined;
      out.push({ rule: r.key, table: c.table, candidates: count, estimatedBytes: estimateMarkBytes(count), ...(note ? { note } : {}) });
    }
    return out;
  }

  /** Apply: marks in batches (a short statement each), never touching a source row. */
  async apply(rules: ExclusionRule[], w: ExclusionWindow, input: { actor: string; batchSize: number; pauseMs: number; notes?: string }) {
    const runId = randomUUID();
    await db.execute(sql`insert into analysis.traffic_exclusion_runs (run_id, mode, rules, window_from, window_to, actor, notes)
      values (${runId}::uuid, 'APPLY', ${pgJsonb(rules.map((r) => r.key))}, ${w.from}, ${w.to}, ${input.actor.slice(0, 80)}, ${input.notes ?? null})`);
    const perRule: Record<string, number> = {};
    let total = 0;
    for (const r of rules) {
      const c = candidates(r.key, w);
      let marked = 0;
      for (;;) {
        const res = rows(await db.execute(sql`
          insert into analysis.traffic_exclusion_marks (source_table, row_id, rule_key, run_id)
          select ${c.table}, x.id, ${r.key}, ${runId}::uuid from (${c.select} limit ${input.batchSize}) x
          on conflict (source_table, row_id) do update set rule_key = excluded.rule_key, run_id = excluded.run_id,
            marked_at = now(), reverted_at = null, reverted_run_id = null
            where analysis.traffic_exclusion_marks.reverted_at is not null
          returning 1 as ok`));
        marked += res.length;
        if (res.length < input.batchSize) break;
        if (input.pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, input.pauseMs));
      }
      perRule[r.key] = marked;
      total += marked;
    }
    await db.execute(sql`update analysis.traffic_exclusion_runs set marked = ${total}, finished_at = now() where run_id = ${runId}::uuid`);
    return { runId, marked: total, perRule };
  }

  /** Revert one run: its marks get reverted_at; the rows come back into every report. */
  async revert(targetRunId: string, input: { actor: string; dryRun: boolean }) {
    const [n] = rows(await db.execute(sql`select count(*)::int as n from analysis.traffic_exclusion_marks where run_id = ${targetRunId}::uuid and reverted_at is null`));
    const count = Number(n?.n ?? 0);
    if (input.dryRun) return { runId: null as string | null, reverted: 0, wouldRevert: count };
    const runId = randomUUID();
    await db.execute(sql`insert into analysis.traffic_exclusion_runs (run_id, mode, rules, actor, notes)
      values (${runId}::uuid, 'REVERT', ${pgJsonb([])}, ${input.actor.slice(0, 80)}, ${`revert of ${targetRunId}`})`);
    const res = rows(await db.execute(sql`update analysis.traffic_exclusion_marks set reverted_at = now(), reverted_run_id = ${runId}::uuid
      where run_id = ${targetRunId}::uuid and reverted_at is null returning 1 as ok`));
    await db.execute(sql`update analysis.traffic_exclusion_runs set reverted = ${res.length}, finished_at = now() where run_id = ${runId}::uuid`);
    return { runId, reverted: res.length, wouldRevert: count };
  }

  /** Active marks per table and rule, for the admin page and the script's summary. */
  async summary() {
    const marks = rows(await db.execute(sql`select source_table, rule_key, count(*)::int as n from analysis.traffic_exclusion_marks
      where reverted_at is null group by source_table, rule_key order by source_table, rule_key`));
    const runs = rows(await db.execute(sql`select run_id, mode, rules, marked, reverted, actor, started_at, finished_at from analysis.traffic_exclusion_runs order by started_at desc limit 20`));
    return {
      activeMarks: marks.map((m) => ({ table: String(m.source_table), rule: String(m.rule_key), rows: Number(m.n) })),
      runs: runs.map((r) => ({ runId: String(r.run_id), mode: String(r.mode), rules: r.rules, marked: Number(r.marked), reverted: Number(r.reverted), actor: String(r.actor), startedAt: r.started_at, finishedAt: r.finished_at })),
    };
  }
}
