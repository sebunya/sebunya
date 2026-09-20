import { sql } from "drizzle-orm";
import { db } from "../db/client";
import type { IRecommendationServingStats } from "../../application/ports/IRecommendationServingStats";

/** A database outage longer than this starts dropping the oldest hour. */
const MAX_HOURS_HELD = 6;

/** Keys are (hour x closed placement enum); this is a backstop, not the bound. */
const MAX_KEYS = 256;
/**
 * A write that errors may still have committed (timeout after commit). Each
 * retry of such a bucket can add it again, so retries are capped: the worst
 * overcount of one bucket is MAX_ATTEMPTS-1 copies of ONE interval's count.
 */
const MAX_ATTEMPTS = 3;

type Bucket = { hour: string; placement: string; responses: number; empty: number; fallback: number; last: Date; attempts: number };

/**
 * Counts in memory, flushes one upsert per (hour, placement) a minute. A busy
 * hour costs a handful of row updates instead of thousands of inserts. Counts
 * held at a crash (at most one interval) are lost — acceptable for a health
 * gauge, and the reason this is not used for anything commercial.
 */
export class RecommendationServingStats implements IRecommendationServingStats {
  private buckets = new Map<string, Bucket>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;
  private droppedSinceReport = 0;

  constructor(
    private readonly onFlushFailed: (error: unknown, held: { retained: number; droppedResponses: number }) => void,
    private readonly flushEveryMs = 60_000,
  ) {}

  record(fact: { placement: string; empty: boolean; fallbackServed: boolean; at: Date }): void {
    try {
      const hour = new Date(Math.floor(fact.at.getTime() / 3_600_000) * 3_600_000).toISOString();
      const key = `${hour}|${fact.placement}`;
      let b = this.buckets.get(key);
      if (!b) {
        if (this.buckets.size >= MAX_KEYS) { this.droppedSinceReport += 1; return; }
        b = { hour, placement: fact.placement, responses: 0, empty: 0, fallback: 0, last: fact.at, attempts: 0 };
        this.buckets.set(key, b);
      }
      b.responses += 1;
      if (fact.empty) b.empty += 1;
      if (fact.fallbackServed) b.fallback += 1;
      if (fact.at > b.last) b.last = fact.at;
      if (!this.timer) {
        this.timer = setInterval(() => void this.flush(), this.flushEveryMs);
        this.timer.unref?.();
      }
    } catch {
      // Counting must never turn a served page into an error.
    }
  }

  /**
   * Accuracy model — an approximate health gauge, NOT a ledger:
   *  - Processes add into the same row, so several API workers combine.
   *  - Buckets are swapped out before writing: serves during a flush land in
   *    the next batch; an in-flight batch is never mutated. One flush at a
   *    time per process.
   *  - Each bucket is its own statement and its own retry unit. A FAILED
   *    bucket is merged back as a separate "retry" debt and tried again, at
   *    most MAX_ATTEMPTS times, then dropped and reported.
   *  - LOSS: whatever is in memory dies with the process. Healthy database:
   *    up to one interval. During an outage: everything retained so far (up
   *    to MAX_HOURS_HELD hours). Nothing here is durable before it is written.
   *  - DUPLICATION: a write that errored after committing is re-added on
   *    retry; bounded by MAX_ATTEMPTS per bucket, per process.
   *  - Drops are reported through the logger, which does not need the database.
   */
  async flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.buckets.size === 0 && this.droppedSinceReport === 0) return;
    this.inFlight = this.flushOnce().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async flushOnce(): Promise<void> {
    const pending = [...this.buckets.values()];
    this.buckets = new Map();
    const failed: Bucket[] = [];
    let firstError: unknown;
    for (const b of pending) {
      try {
        await db.execute(sql`
          insert into recommendation_serving_hourly (hour, placement, responses, empty, fallback_served, last_response_at)
          values (${b.hour}::timestamptz, ${b.placement}, ${b.responses}, ${b.empty}, ${b.fallback}, ${b.last.toISOString()}::timestamptz)
          on conflict (hour, placement) do update set
            responses = recommendation_serving_hourly.responses + excluded.responses,
            empty = recommendation_serving_hourly.empty + excluded.empty,
            fallback_served = recommendation_serving_hourly.fallback_served + excluded.fallback_served,
            last_response_at = greatest(recommendation_serving_hourly.last_response_at, excluded.last_response_at)
        `);
      } catch (error) {
        firstError ??= error;
        b.attempts += 1;
        failed.push(b);
      }
    }
    let dropped = this.droppedSinceReport;
    this.droppedSinceReport = 0;
    for (const b of failed) {
      const key = `${b.hour}|${b.placement}`;
      const expired = Date.now() - Date.parse(b.hour) >= MAX_HOURS_HELD * 3_600_000;
      const now = this.buckets.get(key);
      if (expired || b.attempts >= MAX_ATTEMPTS) {
        dropped += b.responses;
      } else if (now) {
        now.responses += b.responses; now.empty += b.empty; now.fallback += b.fallback;
        now.attempts = Math.max(now.attempts, b.attempts);
      } else if (this.buckets.size < MAX_KEYS) {
        this.buckets.set(key, b);
      } else {
        dropped += b.responses;
      }
    }
    if (firstError !== undefined || dropped > 0) this.onFlushFailed(firstError, { retained: failed.length, droppedResponses: dropped });
  }

  /** Shutdown: one last flush, never longer than the deadline. */
  async stop(deadlineMs = 3_000): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Joins a flush already in flight, then writes what arrived meanwhile. The
    // deadline only stops US waiting: the query itself is ended when the
    // caller closes the pool right after, and its counts are lost (see LOSS).
    const drain = (async () => { await this.flush(); await this.flush(); })();
    await Promise.race([drain, new Promise<void>((r) => setTimeout(r, deadlineMs).unref?.())]);
  }
}
