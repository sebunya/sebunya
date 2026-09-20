import { sql } from "drizzle-orm";
import { db } from "../db/client";
import type { IRecommendationServingStats } from "../../application/ports/IRecommendationServingStats";

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

  constructor(
    private readonly onFlushFailed: (error: unknown) => void,
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

  async flush(): Promise<void> {
    if (this.buckets.size === 0) return;
    const pending = [...this.buckets.values()];
    this.buckets = new Map();
    try {
      for (const b of pending) {
        await db.execute(sql`
          insert into recommendation_serving_hourly (hour, placement, responses, empty, fallback_served, last_response_at)
          values (${b.hour}::timestamptz, ${b.placement}, ${b.responses}, ${b.empty}, ${b.fallback}, ${b.last.toISOString()}::timestamptz)
          on conflict (hour, placement) do update set
            responses = recommendation_serving_hourly.responses + excluded.responses,
            empty = recommendation_serving_hourly.empty + excluded.empty,
            fallback_served = recommendation_serving_hourly.fallback_served + excluded.fallback_served,
            last_response_at = greatest(recommendation_serving_hourly.last_response_at, excluded.last_response_at)
        `);
      }
    } catch (error) {
      this.onFlushFailed(error);
    }
  }
}
