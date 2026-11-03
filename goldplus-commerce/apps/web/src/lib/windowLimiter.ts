/**
 * A small fixed-window budget per key, in memory. `take(key, cost)` spends `cost` units (a JSON-RPC batch of 20 is 20
 * calls, not one). When the map grows past `maxKeys` only EXPIRED windows are dropped, then the oldest windows; a
 * live visitor's spent budget is never wiped wholesale, which `clear()` did to everyone at once under load.
 */
export class WindowLimiter {
  private readonly windows = new Map<string, { start: number; n: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 5000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  take(key: string, cost = 1): boolean {
    const t = this.now();
    const cur = this.windows.get(key);
    if (!cur || t - cur.start > this.windowMs) {
      if (!cur && this.windows.size >= this.maxKeys) this.prune(t);
      this.windows.delete(key);
      this.windows.set(key, { start: t, n: cost });
      return cost <= this.limit;
    }
    cur.n += cost;
    return cur.n <= this.limit;
  }

  get size(): number {
    return this.windows.size;
  }

  private prune(t: number): void {
    for (const [k, w] of this.windows) if (t - w.start > this.windowMs) this.windows.delete(k);
    // Still full of live windows: drop the oldest (insertion order is start order), closest to expiring anyway.
    const excess = this.windows.size - this.maxKeys + 1;
    if (excess > 0) {
      let i = 0;
      for (const k of this.windows.keys()) {
        if (i++ >= excess) break;
        this.windows.delete(k);
      }
    }
  }
}
