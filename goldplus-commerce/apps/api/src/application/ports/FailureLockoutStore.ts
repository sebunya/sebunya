/**
 * Counts FAILURES (not requests) for a key inside a rolling window, so a
 * brute-force against one order reference locks that reference for that
 * caller wherever the request lands. The public order lookup kept this in a
 * per-process Map; with two API replicas behind the edge a burst of six wrong
 * contacts was split ~3/3 and the lockout never fired (proven live,
 * 2026-09-12). The store must be shared across replicas.
 */
export interface FailureLockoutStore {
  failures(key: string, now: number): Promise<number>;
  recordFailure(key: string, now: number, windowMs: number): Promise<void>;
  clear(key: string): Promise<void>;
}

/** In-process implementation: tests, and the fallback when Redis is unreachable. */
export class MemoryFailureLockout implements FailureLockoutStore {
  private readonly entries = new Map<string, { count: number; resetTime: number }>();
  async failures(key: string, now: number): Promise<number> {
    const e = this.entries.get(key);
    if (!e || e.resetTime <= now) { this.entries.delete(key); return 0; }
    return e.count;
  }
  async recordFailure(key: string, now: number, windowMs: number): Promise<void> {
    const e = this.entries.get(key);
    if (e && e.resetTime > now) e.count += 1;
    else this.entries.set(key, { count: 1, resetTime: now + windowMs });
  }
  async clear(key: string): Promise<void> { this.entries.delete(key); }
  get size(): number { return this.entries.size; }
}
