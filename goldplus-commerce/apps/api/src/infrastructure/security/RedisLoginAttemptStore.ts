import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { logger } from '../logging/logger';
import { ILoginAttemptStore } from '../../application/ports/ILoginAttemptStore';
import { InMemoryLoginAttemptStore } from './InMemoryLoginAttemptStore';

/**
 * Login lockout counters, shared across replicas.
 *
 * The in-memory store this fronts was not a production control. Every replica
 * counted independently, so a "5 failures then lock" policy was really 5 × N
 * failures across N instances — and nothing in the configuration said so. It
 * also reset on every deploy, which is a scheduled amnesty for anyone mid-attack.
 *
 * Keys are hashed. The throttle key contains the email address, and storing that
 * in plaintext in a cache would put an inventory of registered addresses one
 * `KEYS *` away from anyone with Redis access.
 *
 * Failure timestamps are held in a sorted set scored by time, so the 15-minute
 * window is a range query rather than a read-filter-write cycle that two
 * concurrent failures could interleave and lose.
 */
const WINDOW_MS = 15 * 60 * 1000;
const KEY_TTL_SECONDS = Math.ceil((WINDOW_MS * 2) / 1000);

export class RedisLoginAttemptStore implements ILoginAttemptStore {
  private client: Redis | null = null;
  private unavailableUntil = 0;

  constructor(
    private readonly redisUrl: string | undefined = process.env.REDIS_URL,
    /**
     * Emergency fallback only. Per-replica, so it under-counts across a cluster;
     * it exists so a Redis outage degrades the lockout rather than removing it.
     */
    private readonly fallback: ILoginAttemptStore = new InMemoryLoginAttemptStore(),
  ) {}

  private connect(): Redis | null {
    if (this.client) return this.client;
    if (!this.redisUrl) return null;
    try {
      this.client = new Redis(this.redisUrl, {
        connectTimeout: 1_000,
        commandTimeout: 250,
        maxRetriesPerRequest: 1,
        // Commands issued while the connection is still being established must
        // WAIT for it, not be rejected. With the offline queue disabled, every
        // request in that window was treated as a Redis outage and silently
        // decided by the local fallback — which is the first burst after every
        // deploy or restart, exactly when a flood is most likely. commandTimeout
        // still bounds the wait, so a genuinely dead Redis degrades promptly
        // rather than hanging the request.
        enableOfflineQueue: true,
      });
      this.client.on('error', (err) => logger.warn({ err: err.message }, 'LOGIN_STORE_REDIS_ERROR'));
      return this.client;
    } catch (err) {
      logger.error({ err: String(err) }, 'LOGIN_STORE_REDIS_CONNECT_FAILED');
      return null;
    }
  }

  private redisKey(key: string): string {
    return `login:fail:${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
  }

  private available(): Redis | null {
    if (Date.now() < this.unavailableUntil) return null;
    return this.connect();
  }

  private degrade(err: unknown): void {
    this.unavailableUntil = Date.now() + 5_000;
    logger.warn({ err: String(err) }, 'LOGIN_STORE_DEGRADED');
  }

  async getFailures(key: string): Promise<Date[]> {
    const client = this.available();
    if (!client) return this.fallback.getFailures(key);
    try {
      const cutoff = Date.now() - WINDOW_MS;
      const members = await client.zrangebyscore(this.redisKey(key), cutoff, '+inf');
      return members.map((m) => new Date(Number(m.split(':')[0])));
    } catch (err) {
      this.degrade(err);
      return this.fallback.getFailures(key);
    }
  }

  async addFailure(key: string, at: Date): Promise<void> {
    const client = this.available();
    if (!client) return this.fallback.addFailure(key, at);
    try {
      const redisKey = this.redisKey(key);
      const score = at.getTime();
      await client
        .multi()
        // The member is unique per attempt so two failures at the same
        // millisecond are two failures, not one deduplicated entry.
        .zadd(redisKey, score, `${score}:${Math.random().toString(36).slice(2, 10)}`)
        .zremrangebyscore(redisKey, '-inf', score - WINDOW_MS)
        .expire(redisKey, KEY_TTL_SECONDS)
        .exec();
    } catch (err) {
      this.degrade(err);
      await this.fallback.addFailure(key, at);
    }
  }

  async clear(key: string): Promise<void> {
    const client = this.available();
    // Always clear the fallback too: a successful login must not leave a stale
    // local counter that could lock the user out after a Redis blip.
    await this.fallback.clear(key);
    if (!client) return;
    try {
      await client.del(this.redisKey(key));
    } catch (err) {
      this.degrade(err);
    }
  }

  async probe(): Promise<{ available: boolean }> {
    const client = this.connect();
    if (!client) return { available: false };
    try {
      await client.ping();
      return { available: true };
    } catch {
      return { available: false };
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
      this.client = null;
    }
  }
}
