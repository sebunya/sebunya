import { ILoginAttemptStore } from '../../application/ports/ILoginAttemptStore';

const MAX_AGE_MS = 60 * 60 * 1000; // entries older than an hour are irrelevant to any window
/**
 * Ceiling on remembered (account, address) pairs. They live 30 days and the Redis store mirrors every successful
 * sign-in here, so expiry alone let the map grow for the life of the process. Oldest are dropped first; forgetting
 * one only means that pair is treated as new once.
 */
export const MAX_REMEMBERED = 20_000;

/** Process-local store, pruned periodically — mirrors the middleware limiter pattern. */
export class InMemoryLoginAttemptStore implements ILoginAttemptStore {
  private readonly failures = new Map<string, Date[]>();
  private readonly remembered = new Map<string, number>();

  constructor() {
    setInterval(() => this.prune(), 5 * 60 * 1000).unref?.();
  }

  private prune(): void {
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const [key, times] of this.failures.entries()) {
      const kept = times.filter((t) => t.getTime() >= cutoff);
      if (kept.length === 0) this.failures.delete(key);
      else this.failures.set(key, kept);
    }
    const now = Date.now();
    for (const [key, until] of this.remembered.entries()) {
      if (until <= now) this.remembered.delete(key);
    }
  }

  async getFailures(key: string): Promise<Date[]> {
    return this.failures.get(key) ?? [];
  }

  async addFailure(key: string, at: Date): Promise<void> {
    const list = this.failures.get(key) ?? [];
    list.push(at);
    this.failures.set(key, list.slice(-20));
  }

  async clear(key: string): Promise<void> {
    this.failures.delete(key);
  }

  async remember(key: string, ttlSeconds: number): Promise<void> {
    // Re-inserted so Map order is oldest-remembered first, then the oldest are evicted past the ceiling.
    this.remembered.delete(key);
    this.remembered.set(key, Date.now() + ttlSeconds * 1000);
    while (this.remembered.size > MAX_REMEMBERED) {
      const oldest = this.remembered.keys().next().value;
      if (oldest === undefined) break;
      this.remembered.delete(oldest);
    }
  }

  async isRemembered(key: string): Promise<boolean> {
    const until = this.remembered.get(key);
    if (until === undefined) return false;
    if (until <= Date.now()) { this.remembered.delete(key); return false; }
    return true;
  }
}
