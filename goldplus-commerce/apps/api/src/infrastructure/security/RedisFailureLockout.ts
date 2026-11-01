import Redis from 'ioredis';
import { FailureLockoutStore, MemoryFailureLockout } from '../../application/ports/FailureLockoutStore';
import { logger } from '../logging/logger';

/**
 * Shared failure counter on Redis (INCR + first-write PEXPIRE), so every API
 * replica sees the same count. When Redis is unreachable it falls back to a
 * per-process counter for five seconds at a time — the same posture as the
 * abuse-control store: never fail open across the whole window, never make a
 * Redis blip block every customer.
 */
export class RedisFailureLockout implements FailureLockoutStore {
  private client: Redis | null = null;
  private unavailableUntil = 0;
  private readonly local = new MemoryFailureLockout();

  constructor(private readonly prefix: string, private readonly redisUrl: string | undefined = process.env.REDIS_URL) {}

  private connect(): Redis | null {
    if (this.client) return this.client;
    if (!this.redisUrl) return null;
    try {
      // Same recipe as the abuse-control store, which is proven against this
      // Redis: connect eagerly, queue commands until the socket is up, and cap
      // each command at 250 ms so a slow Redis degrades to the local counter
      // instead of stalling a request. The first cut used lazyConnect with the
      // offline queue OFF, so a burst's first commands were rejected before
      // the socket existed ("Stream isn't writeable") and every replica fell
      // back to its own counter — the exact split the store exists to close.
      this.client = new Redis(this.redisUrl, { connectTimeout: 1_000, commandTimeout: 250, maxRetriesPerRequest: 1, enableOfflineQueue: true, lazyConnect: false });
      this.client.on('error', (err) => { logger.warn({ err: err.message }, '[FailureLockout] redis error'); });
      return this.client;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '[FailureLockout] redis unavailable');
      return null;
    }
  }

  private key(k: string): string { return `${this.prefix}:${k}`; }

  private degrade(now: number, err: unknown): void {
    this.unavailableUntil = now + 5_000;
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[FailureLockout] falling back to local counter');
  }

  async failures(key: string, now: number): Promise<number> {
    if (now < this.unavailableUntil) return this.local.failures(key, now);
    const c = this.connect();
    if (!c) return this.local.failures(key, now);
    try {
      const v = await c.get(this.key(key));
      return v ? Number(v) || 0 : 0;
    } catch (err) { this.degrade(now, err); return this.local.failures(key, now); }
  }

  async recordFailure(key: string, now: number, windowMs: number): Promise<void> {
    if (now < this.unavailableUntil) return this.local.recordFailure(key, now, windowMs);
    const c = this.connect();
    if (!c) return this.local.recordFailure(key, now, windowMs);
    try {
      const k = this.key(key);
      const n = await c.incr(k);
      if (n === 1) await c.pexpire(k, windowMs);
    } catch (err) { this.degrade(now, err); return this.local.recordFailure(key, now, windowMs); }
  }

  async clear(key: string): Promise<void> {
    await this.local.clear(key);
    const c = this.connect();
    if (!c) return;
    try { await c.del(this.key(key)); } catch { /* a stale counter expires on its own */ }
  }
}
