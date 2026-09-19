import { sql } from 'drizzle-orm';
import { db } from '../client';
import { pgJsonb } from '../PgParams';
import type { BatchReceipt, CollectorStore } from '../../../application/use-cases/telemetry/CollectBrowserBatchUseCase';
import { environmentOf } from '../../../domain/measurement/BusinessEvents';

const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));

export class DrizzleCollectorStore implements CollectorStore {
  async findBatch(batchId: string) {
    const r = rows(await db.execute(sql`select content_sha256, receipt_id, results from measurement.collector_batch where batch_id = ${batchId}::uuid`))[0];
    if (!r) return null;
    const res = typeof r.results === 'string' ? JSON.parse(r.results) : r.results;
    return { contentSha256: String(r.content_sha256), receipt: { receiptId: String(r.receipt_id), accepted: res.accepted ?? [], rejected: res.rejected ?? [] } as BatchReceipt };
  }
  async saveBatch(batchId: string, digest: string, pageInstanceId: string | null, receipt: BatchReceipt) {
    const r = rows(await db.execute(sql`insert into measurement.collector_batch (batch_id, content_sha256, receipt_id, page_instance_id, accepted, rejected, results)
      values (${batchId}::uuid, ${digest}, ${receipt.receiptId}::uuid, ${pageInstanceId}, ${receipt.accepted.length}, ${receipt.rejected.length},
        ${pgJsonb({ accepted: receipt.accepted, rejected: receipt.rejected })})
      on conflict (batch_id) do nothing returning batch_id`));
    return r.length ? 'SAVED' : 'EXISTS';
  }
  async saveTouch(t: Parameters<CollectorStore['saveTouch']>[0]) {
    await db.execute(sql`insert into measurement.touchpoint (touch_id, environment, anonymous_id, client_event_id, occurred_at, channel, source, medium, campaign, referrer_host, landing_path, click_id_types)
      values (${t.touchId}::uuid, ${environmentOf(process.env.NODE_ENV)}, ${t.anonymousId}, ${t.clientEventId}::uuid, ${t.occurredAt.toISOString()}::timestamptz, ${t.channel},
        ${t.source}, ${t.medium}, ${t.campaign}, ${t.referrerHost}, ${t.landingPath}, ${`{${t.clickIdTypes.map((c) => c.replace(/[^A-Za-z_]/g, '')).join(',')}}`}::text[])
      on conflict (environment, anonymous_id, client_event_id) do nothing`);
  }
}
