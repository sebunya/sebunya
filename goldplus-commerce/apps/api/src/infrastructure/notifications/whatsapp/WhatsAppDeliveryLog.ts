import Redis from 'ioredis';
import { logger } from '../../logging/logger';
import type { WhatsAppDeliveryLog, WhatsAppDeliveryRecord } from '../../../application/ports/WhatsAppAds';

const KEY = 'goldplus:whatsapp:deliveries';
const KEEP = 50;
const TTL_SECONDS = 30 * 86_400;

/**
 * Meta's webhook deliveries, kept in Redis (newest first, last 50, 30 days): both api replicas write and read the
 * same list, and a deploy or restart does not erase it. On 2026-10-14 a per-replica, in-memory list was wiped by
 * every restart during the first live WhatsApp test, and hid whether Meta had sent anything at all.
 * Holds no personal data: counts, account ids, Meta's field names and a note.
 */
export class RedisWhatsAppDeliveryLog implements WhatsAppDeliveryLog {
  private client: Redis | null = null;
  constructor(private readonly redisUrl: string | undefined = process.env.REDIS_URL) {}

  private connect(): Redis | null {
    if (this.client) return this.client;
    if (!this.redisUrl) return null;
    try {
      this.client = new Redis(this.redisUrl, { connectTimeout: 1_000, commandTimeout: 500, maxRetriesPerRequest: 1, enableOfflineQueue: true });
      this.client.on('error', (err) => logger.warn({ err: err.message }, 'WHATSAPP_DELIVERY_LOG_REDIS_ERROR'));
      return this.client;
    } catch {
      return null;
    }
  }

  async record(d: WhatsAppDeliveryRecord): Promise<void> {
    const r = this.connect();
    if (!r) return;
    await r.multi().lpush(KEY, JSON.stringify(d)).ltrim(KEY, 0, KEEP - 1).expire(KEY, TTL_SECONDS).exec();
  }

  async recent(limit: number): Promise<WhatsAppDeliveryRecord[]> {
    const r = this.connect();
    if (!r) throw new Error('no redis');
    const rows = await r.lrange(KEY, 0, Math.max(0, Math.min(limit, KEEP) - 1));
    return rows.map((x) => { try { return JSON.parse(x) as WhatsAppDeliveryRecord; } catch { return null; } }).filter((x): x is WhatsAppDeliveryRecord => !!x);
  }
}
