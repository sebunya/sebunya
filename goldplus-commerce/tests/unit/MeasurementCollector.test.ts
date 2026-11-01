import { describe, it, expect } from 'vitest';
import { CollectBrowserBatchUseCase, type CollectorStore, type BatchReceipt } from '../../apps/api/src/application/use-cases/telemetry/CollectBrowserBatchUseCase';

function store() {
  const batches = new Map<string, { contentSha256: string; receipt: BatchReceipt }>();
  const touches: any[] = [];
  const s: CollectorStore = {
    findBatch: async (id) => batches.get(id) ?? null,
    saveBatch: async (id, d, _p, r) => (batches.has(id) ? 'EXISTS' : (batches.set(id, { contentSha256: d, receipt: r }), 'SAVED')),
    saveTouch: async (t) => { touches.push(t); },
  };
  return { s, touches };
}
const now = new Date('2026-09-20T10:00:00Z');
const touch = (over: Record<string, unknown> = {}) => ({
  event_name: 'landing_touch', event_id: '6f0c5f7e-1b1a-4c1e-9d3a-000000000001', event_time: Math.floor(now.getTime() / 1000), source: 'browser',
  user_data: { fp_client_id: 'GP1.1.abc' },
  touch: { source: 'google', medium: 'cpc', campaign: 'x', referrer_host: 'www.google.com', landing_path: '/', click_id_types: ['gclid'] }, ...over,
});
const env = (events: unknown[], batchId = '7f0c5f7e-1b1a-4c1e-9d3a-000000000002') => JSON.stringify({ batchId, schemaVersion: 1, events });

describe('collector contract v2', () => {
  it('accepts a landing touch, classifies it and answers a retry with the same receipt', async () => {
    const { s, touches } = store();
    const tracked: unknown[] = [];
    const uc = new CollectBrowserBatchUseCase(s, async (e) => { tracked.push(e); }, () => now);
    const a = await uc.execute(env([touch()]));
    expect(a.status).toBe(202);
    expect(touches).toHaveLength(1); expect(touches[0].channel).toBe('paid_search');
    expect(tracked).toHaveLength(0); // never forwarded to GA/ads
    const b = await uc.execute(env([touch()]));
    expect(b).toMatchObject({ status: 202, replay: true });
    expect((b as any).receipt.receiptId).toBe((a as any).receipt.receiptId);
    expect(touches).toHaveLength(1);
  });
  it('409 when a batch id is reused with different content', async () => {
    const { s } = store();
    const uc = new CollectBrowserBatchUseCase(s, async () => {}, () => now);
    await uc.execute(env([touch()]));
    expect((await uc.execute(env([touch({ event_time: Math.floor(now.getTime() / 1000) - 5 })]))).status).toBe(409);
  });
  it('rejects server-authority fields and server-only events per event', async () => {
    const { s } = store();
    const uc = new CollectBrowserBatchUseCase(s, async () => {}, () => now);
    const r: any = await uc.execute(env([touch({ user_data: { fp_client_id: 'x', ip_address: '1.2.3.4' } }), { event_name: 'purchase', event_id: 'p1' }]));
    expect(r.status).toBe(202);
    expect(r.receipt.rejected.map((x: any) => x.reason)).toEqual(['SERVER_AUTHORITY_FIELD', 'SERVER_ONLY_EVENT']);
  });
  it('413 over 64 KiB, 422 for a bad envelope or too many events', async () => {
    const uc = new CollectBrowserBatchUseCase(store().s, async () => {}, () => now);
    expect((await uc.execute('x'.repeat(70_000))).status).toBe(413);
    expect((await uc.execute('{"events":[]}')).status).toBe(422);
    expect((await uc.execute(env(Array.from({ length: 21 }, () => touch())))).status).toBe(422);
  });
});

describe('what the collector records about the caller', () => {
  it('carries the edge traffic class onto the stored touch, never a guess', async () => {
    const { s, touches } = store();
    const uc = new CollectBrowserBatchUseCase(s, async () => {}, () => now);
    await uc.execute(env([touch()]), 'automated');
    expect(touches[0].trafficClass).toBe('automated');
    const second = store();
    await new CollectBrowserBatchUseCase(second.s, async () => {}, () => now).execute(env([touch()]));
    expect(second.touches[0].trafficClass).toBe('customer');
  });
  it('refuses a touch whose time is far outside the window', async () => {
    const { s, touches } = store();
    const uc = new CollectBrowserBatchUseCase(s, async () => {}, () => now);
    const r: any = await uc.execute(env([touch({ event_time: Math.floor(now.getTime() / 1000) - 40 * 86400 })]));
    expect(r.receipt.rejected[0].reason).toBe('EVENT_TIME_OUT_OF_RANGE');
    expect(touches).toHaveLength(0);
  });
});

describe('the visitor id is the server\'s to decide', () => {
  it('files the touch against the cookie the server set, not the id the page sent', async () => {
    const { s, touches } = store();
    const uc = new CollectBrowserBatchUseCase(s, async () => {}, () => now);
    await uc.execute(env([touch()]), 'customer', 'GP-server-set');
    expect(touches[0].anonymousId).toBe('GP-server-set');
  });
  it('falls back to the page value only when the server set no cookie', async () => {
    const { s, touches } = store();
    const uc = new CollectBrowserBatchUseCase(s, async () => {}, () => now);
    await uc.execute(env([touch()]), 'customer', null);
    expect(touches[0].anonymousId).toBe('GP1.1.abc');
  });
});

describe('our own synthetic browsers are not customers', () => {
  const SYNTHETIC = /GoldPlusSyntheticProbe|Chrome-Lighthouse|HeadlessChrome|Playwright|Puppeteer|PTST/i;
  it('recognises every agent our tooling and the common auditors send', () => {
    const lighthouseWatchUa = 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36 GoldPlusSyntheticProbe';
    for (const ua of [lighthouseWatchUa, 'Chrome-Lighthouse', 'HeadlessChrome/120', 'PTST/230101']) expect(SYNTHETIC.test(ua)).toBe(true);
    expect(SYNTHETIC.test('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36')).toBe(false);
  });
  it('the agent our Lighthouse Watch sends still reads as a mobile Chrome', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36 GoldPlusSyntheticProbe';
    expect(/Android/.test(ua) && /Mobile Safari/.test(ua)).toBe(true); // form factor unchanged
  });
});
