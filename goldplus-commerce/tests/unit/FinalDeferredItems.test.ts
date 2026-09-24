import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { confirmedRetailPrice } from '../../apps/api/src/infrastructure/db/repositories/DrizzleAuthorizedCartRepository';
import { ApplyRefundConsequencesUseCase } from '../../apps/api/src/application/use-cases/payments/ApplyRefundConsequencesUseCase';
import { CancelFulfilmentTaskForCancelledOrderUseCase } from '../../apps/api/src/application/use-cases/fulfilment/CancelFulfilmentTaskForCancelledOrderUseCase';
import { MerchantFeedCache } from '../../apps/api/src/application/use-cases/seo-growth/MerchantFeedCache';
import { summariseMatchQuality } from '../../apps/api/src/infrastructure/measurement/DrizzleAttributionRepository';
import { RunLoyaltyDailySweepUseCase } from '../../apps/api/src/application/use-cases/loyalty/LoyaltyCompletionUseCases';
import { DomainError } from '../../apps/api/src/domain/errors/DomainError';
import type { LoyaltyLedgerEntry } from '../../apps/api/src/domain/loyalty/LoyaltyLedger';

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

describe('#20 battery evidence upload reads files one at a time', () => {
  it('no Promise.all over uploaded files in the evidence or media-import routes', () => {
    for (const p of ['apps/api/src/interfaces/http/routes/admin/batteries.ts', 'apps/api/src/interfaces/http/routes/admin/media-imports.ts']) {
      const src = read(p);
      expect(src).not.toMatch(/Promise\.all\(files\.map\(async \(f\) => \(\{ filename: f\.name/);
      expect(src).toMatch(/for \(const f of files\) buffers\.push\(\{ filename: f\.name, mime: f\.type, buffer: Buffer\.from\(await f\.arrayBuffer\(\)\) \}\);/);
    }
  });
});

describe('cart lines are priced by the same rule as the product DTO (has_retail_price)', () => {
  it('a price only when has_retail_price AND a positive whole retail price', () => {
    expect(confirmedRetailPrice(true, 150_000)).toBe(150_000);
    expect(confirmedRetailPrice(false, 150_000)).toBeNull();
    expect(confirmedRetailPrice(true, null)).toBeNull();
    expect(confirmedRetailPrice(true, 0)).toBeNull();
    expect(confirmedRetailPrice(true, 12.5)).toBeNull();
  });
  it('find() and findPurchasable() never fall back to products.price_ugx', () => {
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzleAuthorizedCartRepository.ts');
    expect(src).not.toMatch(/fallbackPrice/);
    expect(src).not.toMatch(/retailPrice \?\? /);
    expect(src.match(/confirmedRetailPrice\((line|row)\.hasRetailPrice, (line|row)\.retailPrice\)/g)?.length).toBe(2);
  });
});

describe('F19: a refund that cancels the order closes its fulfilment task', () => {
  const attempt = { id: 'a1', orderId: 'o1', amount: 100_000, orderTrackingId: 't1', merchantReference: 'GP-1' };
  const ctx = { actorType: 'system' as never, source: 'pesapal' as never, providerConfirmed: true, actorId: null };
  const paymentRepo = () => ({ updatePaymentAttemptStatus: vi.fn(), updateOrderPaymentStatusSafely: vi.fn() });

  it('total refund: cancels the order, then the task', async () => {
    const calls: string[] = [];
    const transition = { transition: vi.fn(async () => { calls.push('order'); }) };
    const fulfilment = { execute: vi.fn(async () => { calls.push('task'); }) };
    await new ApplyRefundConsequencesUseCase(paymentRepo(), transition as never, undefined, undefined, fulfilment).execute(attempt, ctx);
    expect(calls).toEqual(['order', 'task']);
    expect(fulfilment.execute).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'o1', actorId: null }));
  });

  it('partial refund, or an order that cannot be cancelled: the task is left alone', async () => {
    const fulfilment = { execute: vi.fn() };
    const ledger = { getRefundedTotalUgx: async () => 40_000 };
    await new ApplyRefundConsequencesUseCase(paymentRepo(), { transition: vi.fn() } as never, ledger, undefined, fulfilment).execute(attempt, ctx);
    const refusing = { transition: vi.fn(async () => { throw new DomainError('delivered orders cannot be cancelled'); }) };
    await new ApplyRefundConsequencesUseCase(paymentRepo(), refusing as never, undefined, undefined, fulfilment).execute(attempt, ctx);
    expect(fulfilment.execute).not.toHaveBeenCalled();
  });

  it('a task failure never fails the money path', async () => {
    const fulfilment = { execute: vi.fn(async () => { throw new Error('db down'); }) };
    const result = await new ApplyRefundConsequencesUseCase(paymentRepo(), { transition: vi.fn() } as never, undefined, undefined, fulfilment).execute(attempt, ctx);
    expect(result.reading).toBe('total');
  });

  it('goes through the transition use case, and only for a task still open', async () => {
    const transitions = { execute: vi.fn(async () => ({ ok: true as const, taskId: 'k1', orderId: 'o1', from: 'PICKING' as const, to: 'CANCELLED' as const })) };
    const open = new CancelFulfilmentTaskForCancelledOrderUseCase({ findByOrderId: async () => ({ id: 'k1', status: 'PICKING' }) as never }, transitions);
    expect(await open.execute({ orderId: 'o1', actorId: null, reason: 'refund' })).toEqual({ outcome: 'cancelled', taskId: 'k1' });
    expect(transitions.execute).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'k1', toStatus: 'CANCELLED', actorId: null }));

    transitions.execute.mockClear();
    const done = new CancelFulfilmentTaskForCancelledOrderUseCase({ findByOrderId: async () => ({ id: 'k1', status: 'DELIVERED' }) as never }, transitions);
    expect((await done.execute({ orderId: 'o1', actorId: null, reason: 'refund' })).outcome).toBe('already_closed');
    const none = new CancelFulfilmentTaskForCancelledOrderUseCase({ findByOrderId: async () => null }, transitions);
    expect((await none.execute({ orderId: 'o1', actorId: null, reason: 'refund' })).outcome).toBe('no_task');
    expect(transitions.execute).not.toHaveBeenCalled();
  });

  it('both refund doors are wired to it (provider poll and operator resolution)', () => {
    const registry = read('apps/api/src/infrastructure/Registry.ts');
    expect(registry.match(/new CancelFulfilmentTaskForCancelledOrderUseCase\(this\.fulfilmentRepo, this\.transitionFulfilmentTaskUseCase\)/g)?.length).toBe(2);
  });
});

describe('#4 recommendation events are bot-screened, and the relay forwards the user agent', () => {
  it('botDetectionMiddleware is mounted on POST /recommendations/events', () => {
    expect(read('apps/api/src/interfaces/http/routes/recommendations.ts')).toMatch(/routes\.post\('\/events', botDetectionMiddleware, optionalCustomerSessionMiddleware,/);
  });
  it('the /api/rec relay forwards the browser user agent (capped)', () => {
    expect(read('apps/web/src/pages/api/rec/[...path].ts')).toMatch(/headers\["User-Agent"\] = ua\.slice\(0, 512\)/);
  });
});

describe('#32 the public recently-viewed route is gone', () => {
  it('no GET /recently-viewed on the recommendations router', () => {
    expect(read('apps/api/src/interfaces/http/routes/recommendations.ts')).not.toMatch(/routes\.get\('\/recently-viewed'/);
  });
});

describe('#8/#12 Caddy caps request bodies on the public beacon paths only', () => {
  const caddy = read('Caddyfile');
  it('storefront relays and API beacons have a request_body max_size behind a named matcher', () => {
    expect(caddy).toMatch(/@publicBeacons path \/api\/rec\/\* \/api\/hero\/events \/api\/nav\/events \/api\/csp-report\n\s+request_body @publicBeacons \{\n\s+max_size 16KiB\n\s+\}/);
    expect(caddy).toMatch(/@telemetryBeacons path \/telemetry\/collect \/telemetry\/collect\/batch \/telemetry\/identity\n\s+request_body @telemetryBeacons \{\n\s+max_size 512KB\n\s+\}/);
    expect(caddy).toMatch(/@eventBeacons path \/recommendations\/events \/hero\/events \/nav\/events\n\s+request_body @eventBeacons \{\n\s+max_size 16KiB\n\s+\}/);
  });
  it('never a site-wide body cap (uploads, checkout and forms keep the default)', () => {
    expect(caddy).not.toMatch(/request_body\s*\{/);
    expect(caddy.match(/request_body /g)?.length).toBe(3);
  });
});

describe('#10 the Merchant feed cache clears on an inventory change', () => {
  it('rebuilds when the inventory version moves, serves the cache otherwise, and keeps the 15-minute ceiling', async () => {
    let version = 'v1';
    let clock = 0;
    const cache = new MerchantFeedCache({ current: async () => version }, () => clock);
    let builds = 0;
    const build = async () => `<feed n="${++builds}"/>`;
    expect(await cache.get(build)).toBe('<feed n="1"/>');
    clock = 60_000;
    expect(await cache.get(build)).toBe('<feed n="1"/>');
    version = 'v2'; // a product sold out
    expect(await cache.get(build)).toBe('<feed n="2"/>');
    clock += 15 * 60 * 1000 + 1;
    expect(await cache.get(build)).toBe('<feed n="3"/>');
  });
  it('a failed version read falls back to the ceiling, never fails the feed', async () => {
    let clock = 0;
    const cache = new MerchantFeedCache({ current: async () => { throw new Error('db'); } }, () => clock);
    let builds = 0;
    const build = async () => String(++builds);
    expect(await cache.get(build)).toBe('1');
    clock = 1_000;
    expect(await cache.get(build)).toBe('1');
  });
  it('the route uses the registry cache; the version hashes stock, reserved, status and pre-order', () => {
    const seo = read('apps/api/src/interfaces/http/routes/seo.ts');
    expect(seo).toMatch(/registry\.merchantFeedCache\.get\(/);
    expect(seo).not.toMatch(/let feedCache/);
    const v = read('apps/api/src/infrastructure/db/repositories/DrizzleFeedInventoryVersion.ts');
    for (const col of ['stock_quantity', 'reserved_quantity', 'stock_status', 'is_pre_order_enabled']) expect(v).toContain(col);
  });
});

describe('#19 match quality: aggregated in SQL, null when there is no data', () => {
  it('no events -> null rates, never 0%', () => {
    expect(summariseMatchQuality({ total: 0, avg: null, below40: 0, above80: 0 })).toEqual({ avgScore: null, below40Pct: null, above80Pct: null, totalEvents: 0 });
  });
  it('events -> rounded average and shares', () => {
    expect(summariseMatchQuality({ total: 4, avg: 57.25, below40: 1, above80: 1 })).toEqual({ avgScore: 57.3, below40Pct: 25, above80Pct: 25, totalEvents: 4 });
  });
  it('the repository aggregates in SQL instead of loading every row', () => {
    const src = read('apps/api/src/infrastructure/measurement/DrizzleAttributionRepository.ts');
    const body = src.slice(src.indexOf('async getMatchQualitySummary'));
    expect(body).toMatch(/avg\(\$\{attributionTouchpoints\.matchScore\}\)/);
    expect(body).toMatch(/count\(\*\) filter \(where/);
    expect(body).not.toMatch(/rows\.reduce/);
  });
  it('the admin pages say "No data" instead of 0%', () => {
    expect(read('apps/web/src/pages/admin/measurement/index.astro')).toMatch(/mqHasData \? `\$\{mq\.avgScore\.toFixed\(0\)\}%` : 'No data'/);
    expect(read('apps/web/src/pages/admin/measurement/attribution.astro')).toMatch(/'No data'/);
  });
});

describe('#20 docs no longer describe the removed PurchaseTelemetry path as live', () => {
  it('telemetry-architecture and the truth map name it as removed', () => {
    const arch = read('docs/telemetry-architecture.md');
    expect(arch).not.toMatch(/`EnqueuePurchaseEventUseCase\.ts` evaluates/);
    expect(arch).toMatch(/has been removed/);
    const map = read('docs/measurement/programme/01_CURRENT_STATE_TRUTH_MAP.md');
    expect(map).not.toMatch(/`recordMeasurement` → `queuePurchaseTelemetry`/);
    expect(map).toMatch(/are REMOVED/);
  });
});

describe('Held 7: a queued expiry warning is recorded as queued until dispatch confirms', () => {
  const day = 86_400_000;
  const now = new Date('2026-09-24T00:00:00Z');
  const earn: LoyaltyLedgerEntry = {
    id: 'e1', accountId: 'acc', type: 'earn', points: 1_000, orderId: null, reason: 'earn', idempotencyKey: 'k1',
    expiresAt: new Date(now.getTime() + 7 * day), reversedEntryId: null, createdAt: new Date(now.getTime() - 100 * day),
  };
  const build = (notifyOutcome: 'sent' | 'skipped') => {
    const calls: string[] = [];
    const repo = { listEntries: vi.fn().mockResolvedValue([earn]), expireDue: vi.fn().mockResolvedValue([]), getConfig: vi.fn().mockResolvedValue({ earnRatePer1000Ugx: 10 }), mergedInto: vi.fn().mockResolvedValue(null) };
    const completion = {
      getProgrammeConfig: vi.fn().mockResolvedValue({ enabled: true, killSwitch: false, pointValueUgx: 20, redemptionMinPoints: 100, redemptionMaxShareBps: 2000 }),
      listExpiredReservations: vi.fn().mockResolvedValue([]),
      listAccountIds: vi.fn().mockResolvedValue([]),
      listEarnsNearingExpiry: vi.fn(async () => { calls.push('list'); return [{ entry: earn, userId: 'u1' }]; }),
      confirmQueuedNotices: vi.fn(async () => { calls.push('confirm'); return 0; }),
      noticeAlreadySent: vi.fn().mockResolvedValue(false),
      recordNotice: vi.fn(),
      reservedPoints: vi.fn().mockResolvedValue(0),
      ledgerTotals: vi.fn().mockResolvedValue({ issued: 0, redeemed: 0, expired: 0, outstanding: 0 }),
      writeLiabilitySnapshot: vi.fn(),
    };
    const uc = new RunLoyaltyDailySweepUseCase(repo as never, completion as never, vi.fn().mockResolvedValue(notifyOutcome));
    return { uc, completion, calls };
  };

  it('an enqueued warning is recorded as queued, never as a delivered notification', async () => {
    const { uc, completion, calls } = build('sent');
    await uc.execute(now).catch(() => undefined);
    expect(completion.recordNotice).toHaveBeenCalled();
    for (const [arg] of completion.recordNotice.mock.calls) expect(arg.channel).toBe('queued');
    expect(calls.indexOf('confirm')).toBeLessThan(calls.indexOf('list'));
  });

  it('a warning that never left is suppressed', async () => {
    const { uc, completion } = build('skipped');
    await uc.execute(now).catch(() => undefined);
    for (const [arg] of completion.recordNotice.mock.calls) expect(arg.channel).toBe('suppressed');
  });

  it('the repository promotes queued -> notification only for a processed, error-free outbox event', () => {
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyCompletionRepository.ts');
    expect(src).toMatch(/set channel = 'notification'/);
    expect(src).toMatch(/o\.idempotency_key = 'loyexp:' \|\| n\.earn_entry_id::text \|\| ':' \|\| n\.notice_kind/);
    expect(src).toMatch(/o\.status = 'processed'\s+and o\.last_error is null/);
    expect(src).toMatch(/inArray\(loyaltyExpiryNotices\.channel, \['notification', 'queued'\]\)/);
    // The key the repository matches is the key the Registry enqueues under.
    expect(read('apps/api/src/infrastructure/Registry.ts')).toContain('idempotencyKey: `loyexp:${earnEntryId}:${kind}`');
  });
});
