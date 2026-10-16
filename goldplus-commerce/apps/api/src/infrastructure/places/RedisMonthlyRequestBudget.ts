/**
 * One month-wide counter for paid place requests, shared by both api replicas (Redis INCR on a per-month key).
 * Fails CLOSED: no Redis, no paid call. Cap from GOOGLE_PLACES_MONTHLY_REQUEST_CAP (default 1000, the owner's
 * figure; Google's free caps in October 2026 are 10,000 autocomplete requests and 10,000 Essentials details).
 */
import Redis from 'ioredis';
import type { IMonthlyRequestBudget } from '../../application/ports/IPlaceSearch';
import { logger } from '../logging/logger';

export class RedisMonthlyRequestBudget implements IMonthlyRequestBudget {
  private client: Redis | null = null;

  constructor(
    private readonly prefix = 'places:requests',
    private readonly cap: number = Number(process.env.GOOGLE_PLACES_MONTHLY_REQUEST_CAP) > 0 ? Number(process.env.GOOGLE_PLACES_MONTHLY_REQUEST_CAP) : 1000,
    private readonly redisUrl: string | undefined = process.env.REDIS_URL,
  ) {}

  private key(): string {
    return `${this.prefix}:${new Date().toISOString().slice(0, 7)}`;
  }

  private connect(): Redis | null {
    if (this.client) return this.client;
    if (!this.redisUrl) return null;
    try {
      this.client = new Redis(this.redisUrl, { connectTimeout: 1000, commandTimeout: 300, maxRetriesPerRequest: 1, enableOfflineQueue: true });
      this.client.on('error', (err) => logger.warn({ err: err.message }, 'PLACES_BUDGET_REDIS_ERROR'));
      return this.client;
    } catch {
      return null;
    }
  }

  async tryConsume(): Promise<boolean> {
    const c = this.connect();
    if (!c) return false;
    try {
      const key = this.key();
      const n = await c.incr(key);
      if (n === 1) await c.expire(key, 40 * 24 * 60 * 60);
      if (n > this.cap) {
        if (n === this.cap + 1) logger.warn({ cap: this.cap }, 'PLACES_MONTHLY_BUDGET_REACHED');
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async used(): Promise<number | null> {
    const c = this.connect();
    if (!c) return null;
    try {
      return Number((await c.get(this.key())) ?? 0);
    } catch {
      return null;
    }
  }
}
