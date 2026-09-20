import { sql } from "drizzle-orm";
import { db } from "../db/client";
import type { IRecommendationServingStats } from "../../application/ports/IRecommendationServingStats";

/** A database outage longer than this starts dropping the oldest hour. */
const MAX_HOURS_HELD = 6;

type Bucket = { hour: string; placement: string; responses: number; empty: number; fallback: number; last: Date };

/**
 * Counts in memory, flushes one upsert per (hour, placement) a minute. A busy
 * hour costs a handful of row updates instead of thousands of inserts. Counts
 * held at a crash (at most one interval) are lost — acceptable for a health
 * gauge, and the reason this is not used for anything commercial.
 */
export class RecommendationServingStats implements IRecommendationServingStats {
  private buckets = new Map<string, Bucket>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(
    private readonly onFlushFailed: (error: unknown, held: { retained: number; droppedResponses: number }) => void,
    private readonly flushEveryMs = 60_000,
  ) {}

  record(fact: { placement: string; empty: boolean; fallbackServed: boolean; at: Date }): void {
    const hour = new Date(Math.floor(fact.at.getTime() / 3_600_000) * 3_600_000).toISOString();
    const key = `${hour}|${fact.placement}`;
    const b = this.buckets.get(key) ?? { hour, placement: fact.placement, responses: 0, empty: 0, fallback: 0, last: fact.at };
    b.responses += 1;
    if (fact.empty) b.empty += 1;
    if (fact.fallbackServed) b.fallback += 1;
    if (fact.at > b.last) b.last = fact.at;
    this.buckets.set(key, b);
    if (!this.timer) {
      this.timer = setInterval(() => void this.flush(), this.flushEveryMs);
      this.timer.unref?.();
    }
  }

  /**
   * Accuracy model (a health gauge, not a ledger):
   *  - Workers add into the same row, so several API processes combine.
   *  - Buckets are swapped out before the write, so serves during a flush land
   *    in the next batch and an in-flight batch is never mutated.
   *  - A bucket whose write FAILED is merged back and retried next interval. A
   *    write that timed out after committing would then count twice: bounded to
   *    one interval of one placement, and accepted.
   *  - Held counts are capped (placements x MAX_HOURS_HELD); beyond that the
   *    oldest hour is dropped and reported. Keys are the closed placement enum,
   *    so nothing a caller sends can grow the map.
   *  - A forced kill or OOM loses at most one interval.
   */
  async flush(): Promise<void> {
    if (this.flushing || this.buckets.size === 0) return;
    this.flushing = true;
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
        failed.push(b);
      }
    }
    let dropped = 0;
    for (const b of failed) {
      const key = `${b.hour}|${b.placement}`;
      const now = this.buckets.get(key);
      if (now) {
        now.responses += b.responses; now.empty += b.empty; now.fallback += b.fallback;
      } else if (Date.now() - Date.parse(b.hour) < MAX_HOURS_HELD * 3_600_000) {
        this.buckets.set(key, b);
      } else {
        dropped += b.responses;
      }
    }
    this.flushing = false;
    if (firstError !== undefined) this.onFlushFailed(firstError, { retained: failed.length, droppedResponses: dropped });
  }

  /** Shutdown: one last flush, never longer than the deadline. */
  async stop(deadlineMs = 3_000): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.race([this.flush(), new Promise<void>((r) => setTimeout(r, deadlineMs).unref?.())]);
  }
}
