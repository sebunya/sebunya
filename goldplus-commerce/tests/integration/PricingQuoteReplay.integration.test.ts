import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluatePricing, PricingRule } from '../../apps/api/src/domain/pricing/PricingEvaluator';
import { DrizzlePricingQuoteRepository } from '../../apps/api/src/infrastructure/db/repositories/DrizzlePricingQuoteRepository';

/**
 * U1 AC9 — the PriceQuote persisted against an order reproduces the exact total
 * when replayed, and replay does NOT re-query mutable product prices (findQuote
 * reads the persisted line prices, never the products table). Real PostgreSQL.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('PriceQuote replay reproduces the total (real PostgreSQL, U1 AC9)', () => {
  let raw: any;
  const repo = new DrizzlePricingQuoteRepository();
  let definitionId: string;
  let versionId: string;
  const quoteIds: string[] = [];

  const now = new Date('2026-07-20T00:00:00Z');

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    const [def] = await raw`insert into promotion_definitions (key, name, description, status) values (${`rp-${Date.now()}`}, 'Replay', 'AC9', 'ACTIVE') returning id`;
    definitionId = def.id;
    const [ver] = await raw`
      insert into promotion_versions (definition_id, version_number, status, conditions, benefits, exclusions, starts_at, ends_at, created_by)
      values (${definitionId}, 1, 'ACTIVE', '[]'::jsonb, '[{"type":"PERCENTAGE_OFF","value":1000}]'::jsonb, '[]'::jsonb, ${new Date('2026-07-01')}, ${new Date('2026-08-01')}, ${'00000000-0000-4000-8000-000000000000'}) returning id`;
    versionId = ver.id;
  });

  afterAll(async () => {
    if (!raw) return;
    if (quoteIds.length) {
      await raw`delete from pricing_adjustments where quote_id = any(${quoteIds})`;
      await raw`delete from pricing_quote_lines where quote_id = any(${quoteIds})`;
      await raw`delete from pricing_quotes where id = any(${quoteIds})`;
    }
    await raw`delete from promotion_versions where id = ${versionId}`;
    await raw`delete from promotion_definitions where id = ${definitionId}`;
    await raw.end();
  });

  it('a persisted 10% quote on a 100,000 cart replays to exactly 90,000', async () => {
    const productId = randomUUID();
    const quoteId = randomUUID();
    quoteIds.push(quoteId);
    const rule: PricingRule = {
      definitionId, definitionKey: 'rp', versionId, versionNumber: 1,
      conditions: [], benefits: [{ type: 'PERCENTAGE_OFF', value: 1000 }], exclusions: [],
      schedule: { startsAt: new Date('2026-07-01'), endsAt: new Date('2026-08-01') },
      usagePolicy: { globalLimit: null, perCustomerLimit: null, perCouponLimit: null, reservationTtlSeconds: 900 },
      priority: 10, stackable: false, couponCode: null, priceFloorUgx: 0,
    };
    const quote = evaluatePricing({
      quoteId,
      lines: [{ productId, sku: 'P1', name: 'Item', category: 'A', canonicalUnitPriceUgx: 100_000, quantity: 1 }],
      rules: [rule], couponCode: null, couponReference: null, customerDnaSegments: [], experimentEvidence: [],
      shippingUgx: 0, taxUgx: 0, evaluatedAt: now, expiresAt: new Date(now.getTime() + 3_600_000),
    });
    expect(quote.finalTotalUgx).toBe(90_000);

    await repo.saveQuote(quote, { customerScopeHash: null });

    const replayed = await repo.findQuote(quoteId);
    expect(replayed).not.toBeNull();
    // Exact total reproduced from the persisted artefact.
    expect(replayed!.finalTotalUgx).toBe(90_000);
    // Arithmetic replay from persisted lines (no product re-query).
    const arithmetic = replayed!.lines.reduce((s, l) => s + l.finalSubtotalUgx, 0) + replayed!.shippingUgx + replayed!.taxUgx;
    expect(arithmetic).toBe(90_000);
    // The applied promotion and its discount survive the round-trip.
    expect(replayed!.appliedPromotionVersions.map((v) => v.versionId)).toEqual([versionId]);
    expect(replayed!.adjustments.reduce((s, a) => s + a.amountUgx, 0)).toBe(10_000);
    expect(replayed!.calculationVersion).toBe(quote.calculationVersion);
  });
});
