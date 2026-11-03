import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CollectBrowserBatchUseCase, type CollectorStore, type BatchReceipt } from '../../apps/api/src/application/use-cases/telemetry/CollectBrowserBatchUseCase';
import { validateWorkItem } from '../../apps/api/src/application/use-cases/seo-growth/SeoWorkQueueUseCases';
import { landingTouch, CAMPAIGN_PARAM } from '../../packages/shared/src/attribution/arrival';
import { gaSessionFromCookieHeader } from '../../packages/shared/src/events/telemetry';
import { normaliseWhatsAppRef } from '../../packages/shared/src/attribution/heardAbout';

const now = new Date('2026-09-20T10:00:00Z');
function store(): CollectorStore {
  const batches = new Map<string, { contentSha256: string; receipt: BatchReceipt }>();
  return {
    findBatch: async (id) => batches.get(id) ?? null,
    saveBatch: async (id, d, _p, r) => (batches.has(id) ? 'EXISTS' : (batches.set(id, { contentSha256: d, receipt: r }), 'SAVED')),
    saveTouch: async () => {},
  };
}

describe('review 229: telemetry collector and dashboards', () => {
  it('a primitive user_data is that event\'s rejection, not a 500 for the batch', async () => {
    const uc = new CollectBrowserBatchUseCase(store(), async () => {}, () => now);
    const r = await uc.execute(JSON.stringify({ batchId: '7f0c5f7e-1b1a-4c1e-9d3a-000000000009', schemaVersion: 1, events: [{ event_name: 'view_item', event_id: 'e1', user_data: 'x' }] }));
    expect(r.status).toBe(202);
    expect((r as any).receipt.rejected).toEqual([{ eventId: 'e1', reason: 'SCHEMA_VIOLATION' }]);
  });

  it('an update without a state keeps the item where it is', () => {
    const v = validateWorkItem({ title: 'New title' } as any, { state: 'IN_PROGRESS' });
    expect(v.ok && v.input.state).toBe('IN_PROGRESS');
    const fresh = validateWorkItem({ title: 'New' } as any);
    expect(fresh.ok && fresh.input.state).toBe('BACKLOG');
  });

  it('the control tower counts browser events dead-lettered in the outbox', () => {
    const src = readFileSync('apps/api/src/infrastructure/admin/DrizzleMeasurementControlTowerRepository.ts', 'utf8');
    expect(src).toContain("eq(outboxEvents.eventType, 'TELEMETRY_DISPATCH'), sql`${outboxEvents.status} in (");
    expect(src).toContain('Number(measurementDlq?.value ?? 0) + Number(outboxDlq?.value ?? 0)');
  });
});

describe('review 233: attribution rules', () => {
  const IG = 'Mozilla/5.0 (iPhone) Instagram 300.0';
  it('in-app browser credit only when there is no referrer at all', () => {
    expect(landingTouch({ search: '', referrer: '', ua: IG, selfHost: 'shopgoldplus.com' }).referrerHost).toBe('instagram.com');
    expect(landingTouch({ search: '', referrer: 'https://shopgoldplus.com/products', ua: IG, selfHost: 'shopgoldplus.com' }).referrerHost).toBeNull();
  });
  it('postback click ids and srsltid are carried onto the next page', () => {
    for (const k of ['clickid', 'click_id', 'srsltid', 'gclid', 'utm_source']) expect(CAMPAIGN_PARAM.test(k), k).toBe(true);
  });
  it('a known stream without its cookie gives no session, never another property\'s', () => {
    const other = '_ga_OLDSTREAM=GS1.1.1700000000.4.1.1700000100';
    expect(gaSessionFromCookieHeader(other, 'G-NEWSTREAM')).toBeNull();
    expect(gaSessionFromCookieHeader(`${other}; _ga_NEWSTREAM=GS1.1.1800000000.2.1.1800000100`, 'G-NEWSTREAM')).toEqual({ gaSessionId: '1800000000', gaSessionNumber: 2 });
    expect(gaSessionFromCookieHeader(other, null)).toEqual({ gaSessionId: '1700000000', gaSessionNumber: 4 });
  });
  it('a bare code starting with REF is still a code; "Ref:" and "Ref " prefixes are stripped', () => {
    expect(normaliseWhatsAppRef('REFK7Q')).toBe('GP-REFK7Q');
    expect(normaliseWhatsAppRef('Ref: GP-7K3Q9X')).toBe('GP-7K3Q9X');
    expect(normaliseWhatsAppRef('Ref GP-7K3Q9X')).toBe('GP-7K3Q9X');
  });
  it('analytics windows end before the next Kampala day starts (half-open)', () => {
    for (const f of ['apps/api/src/infrastructure/db/repositories/DrizzleAnalyticsReadRepository.ts', 'apps/api/src/infrastructure/db/repositories/DrizzleSalesFunnelReader.ts']) {
      const s = readFileSync(f, 'utf8');
      expect(s).not.toContain('<= ${end}');
      expect(s).toContain('< ${new Date(end.getTime() + 1)}');
    }
  });
});
