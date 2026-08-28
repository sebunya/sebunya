import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reconcilePayments } from '../../apps/api/src/domain/payments/PaymentReconciliation';

/**
 * The low findings of the 2026-08-27 audit, each hand-verified and fixed.
 * One assertion per fix, so a regression names the finding it reopened.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

describe('what the customer is shown', () => {
  it('a 12.5% promotion is not rounded up to a 13% badge', () => {
    expect(read('apps/api/src/application/pricing/StorefrontDiscountQuery.ts')).toMatch(/percent: benefit\.value \/ 100,/);
  });

  it('an order NUMBER on an id route is not found, not a 500', () => {
    // Guarded where the uuid column is bound, so every caller is covered.
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleOrderRepository.ts')).toMatch(/if \(!UUID_SHAPE\.test\(orderId\)\) return null;/);
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleCheckoutIdempotencyRepository.ts')).toMatch(/\.test\(orderId\)\) return null;/);
  });

  it('the pricing preview never echoes a raw error to an unauthenticated caller', () => {
    const src = read('apps/api/src/interfaces/http/routes/commerce.ts');
    const block = src.slice(src.indexOf("'/pricing-preview'"), src.indexOf('Public odds disclosure'));
    expect(block).toMatch(/if \(error instanceof PricingEvaluationError\)/);
    expect(block).toMatch(/throw error;/);
    expect(block).not.toMatch(/error\.message : 'Pricing preview is unavailable/);
  });

  it('free-text destinations do not share a cached delivery fee', () => {
    expect(read('apps/api/src/interfaces/http/routes/delivery.ts')).toMatch(/const fullKey = `\$\{key\}:\$\{areaText\}:/);
  });

  it('the device page records one selection per view', () => {
    const page = read('apps/web/src/pages/battery-finder.astro');
    expect(page.match(/\/finder\/devices\/\$\{encodeURIComponent\(deviceSlug\)\}/g)?.length).toBe(1);
  });

  it('battery admin pages show Kampala time', () => {
    for (const p of ['index', 'demand', 'stock', 'imports/index', 'imports/[id]', 'catalogue/[id]']) {
      expect(read(`apps/web/src/pages/admin/batteries/${p}.astro`), p).toMatch(/timeZone: 'Africa\/Kampala'/);
    }
  });
});

describe('what the shop records', () => {
  it('a PesaPal-paid order has a success record', () => {
    const report = reconcilePayments({
      orders: [{ id: 'o1', orderNumber: 'GP-1', paymentStatus: 'paid', totalUgx: 145_000 } as never],
      payments: [],
      attempts: [{ orderId: 'o1', status: 'completed', amount: 145_000 } as never],
      now: new Date(),
    });
    expect(report.findings.filter((f) => f.type === 'order_paid_without_success_record')).toEqual([]);
  });

  it('the control tower reports what it measured', () => {
    const src = read('apps/api/src/infrastructure/admin/DrizzleMeasurementControlTowerRepository.ts');
    expect(src).toMatch(/max\(measurementAuditLogs\.createdAt\)/);
    expect(src).not.toMatch(/lastEventReceived: new Date\(\)/);
    expect(src).not.toMatch(/measurementQueueStatus: 'HEALTHY',/);
  });

  it('a cost-import note is stored, not validated and dropped', () => {
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzleProductCostRepository.ts');
    expect(src).toMatch(/\$\{input\.source\}, \$\{row\.note \?\? null\}/);
    expect(src).not.toMatch(/\$\{input\.source\}, \$\{null\}/);
  });

  it('queue replay and concurrency changes are audited', () => {
    const src = read('apps/api/src/interfaces/http/routes/admin/queues.ts');
    expect(src).toMatch(/QUEUE_FAILED_JOBS_REPLAYED/);
    expect(src).toMatch(/QUEUE_CONCURRENCY_CHANGED/);
    expect(src).not.toMatch(/audit-exempt/);
  });

  it('stock status follows quantity on both write paths', () => {
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleInventoryRepository.ts')).toMatch(/stockStatus: sql`case when \$\{newStock\} <= 0 then 'out_of_stock' else 'in_stock' end`/);
  });

  it('expired reservations do not count as consumed capacity', () => {
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzlePricingOperationsRepository.ts')).toMatch(/sql`\$\{promotionReservations\.expiresAt\} > now\(\)`/);
  });

  it('a PIM update keeps a live product’s URL', () => {
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzlePimImportRepository.ts');
    expect(src).toMatch(/slug: existing\.slug,\s*\n\s*updatedAt: new Date\(\),/);
  });
});

describe('what an operator can and cannot do', () => {
  it('a structured address needs a landmark on create, not only on update', () => {
    expect(read('apps/api/src/application/use-cases/addresses/AddressUseCases.ts')).toMatch(/validateCore\(\{ \.\.\.input, landmarkText: input\.landmarkText \?\? '' \}\)/);
  });

  it('an accepted calibration proposal cannot be rejected afterwards', () => {
    const src = read('apps/api/src/application/use-cases/delivery/DeliveryCalibrationUseCases.ts');
    const reject = src.slice(src.indexOf('class RejectCalibrationProposalUseCase'));
    expect(reject).toMatch(/if \(proposal\.status !== 'pending'\)/);
  });

  it('a packing update validates every line before writing any', () => {
    const src = read('apps/api/src/application/use-cases/fulfilment/PackingUseCases.ts');
    const body = src.slice(src.indexOf('class UpdatePackedQuantitiesUseCase'), src.indexOf('class ResolveRemainderUseCase'));
    expect(body.indexOf('prepared.push')).toBeLessThan(body.indexOf('updateWithVersion'));
  });

  it('the beneficiary of a role grant cannot approve it', () => {
    expect(read('apps/api/src/application/use-cases/identity/AdminUserManagementUseCase.ts')).toMatch(/if \(request\.userId === args\.actorId\)/);
  });

  it('resuming a promotion needs the same step-up as activating one', () => {
    expect(read('apps/api/src/interfaces/http/routes/admin/pricing.ts')).toMatch(/STEP_UP_OPERATIONS = new Set\(\['approve', 'activate', 'resume'\]\)/);
  });

  it('a product price is validated as a shilling amount, compare-at included', () => {
    const src = read('apps/api/src/interfaces/http/routes/admin/products.ts');
    expect(src).toMatch(/const MAX_PRICE_UGX = 100_000_000;/);
    expect(src.match(/compareAtPriceUgx !== undefined && \(!Number\.isInteger\(compareAtPriceUgx\)/g)?.length).toBe(2);
  });

  it('a finished packing session is not restarted', () => {
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleFulfilmentLineRepository.ts')).toMatch(/current\.status === 'COMPLETED' \|\| current\.status === 'PARTIAL'\)\) return current;/);
  });

  it('a higher fee cannot be charged to an order already paid', () => {
    expect(read('apps/api/src/application/use-cases/delivery/DeliveryVarianceUseCases.ts')).toMatch(/VARIANCE_ON_PAID_ORDER/);
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleDeliveryVarianceRepository.ts')).toMatch(/paymentStatus: r\.payment_status/);
  });

  it('a battery code fits the column it is stored in', () => {
    expect(read('apps/api/src/domain/batteries/BatteryImport.ts')).toMatch(/canonicalCode\.length > 50/);
    expect(read('apps/api/src/application/use-cases/batteries/BatteryCatalogueUseCases.ts')).toMatch(/canonicalCode\.length > 50/);
  });

  it('a held import row carries the keys apply reads', () => {
    const src = read('apps/api/src/domain/batteries/BatteryImport.ts');
    expect(src.match(/batteryCategory: category, aliases: \[sourceItem\], name: null, codeStatus: 'PROVISIONAL', lifecycleStatus: 'REVIEW'/g)?.length).toBe(2);
  });
});
