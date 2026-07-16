import { ILoginAttemptStore } from '../../application/ports/ILoginAttemptStore';

const MAX_AGE_MS = 60 * 60 * 1000; // entries older than an hour are irrelevant to any window

/** Process-local store, pruned periodically — mirrors the middleware limiter pattern. */
export class InMemoryLoginAttemptStore implements ILoginAttemptStore {
  private readonly failures = new Map<string, Date[]>();

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
}
