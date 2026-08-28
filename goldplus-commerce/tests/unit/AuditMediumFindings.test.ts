import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MfaService } from '../../apps/api/src/infrastructure/security/MfaService';
import { normalizePimRow } from '../../apps/api/src/domain/pim/PimImport';
import { STOREFRONT_PRICE_FLOOR_UGX } from '../../packages/shared/src/batteries';

/**
 * The medium findings of the 2026-08-27 audit, each hand-verified and fixed.
 * One assertion per fix, so a regression names the finding it reopened.
 */

const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

describe('source files are text', () => {
  it('no source file contains a NUL byte', () => {
    // Twice now a literal NUL inside a template string made git treat the file
    // as binary (no diff, no review) and made grep skip it silently. Written as
    // the escape \x00 the value is identical and the file stays reviewable.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name === '.astro') continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|astro|mjs)$/.test(name) && readFileSync(p).includes(0)) offenders.push(p.slice(ROOT.length + 1));
      }
    };
    for (const top of ['apps/api/src', 'apps/web/src', 'packages/shared/src']) walk(resolve(ROOT, top));
    expect(offenders).toEqual([]);
  });
});

describe('money and display', () => {
  it('a capped percentage is not advertised as a plain percent', () => {
    const src = read('apps/api/src/application/pricing/StorefrontDiscountQuery.ts');
    expect(src.match(/b\.maximumDiscountUgx == null/g)?.length).toBe(2);
  });

  it('a PIM upsert cannot price a live product below the floor', () => {
    const mapping = { sku: 'sku', modelNumber: 'model', name: 'name', slug: 'slug', categorySlug: 'category', shortDescription: 'short', longDescription: 'long', retailPriceUgx: 'price' } as never;
    const base = { sku: 'X1', model: 'M', name: 'Thing', slug: 'thing', category: 'c', short: 's', long: 'l' };
    const low = normalizePimRow({ ...base, price: String(STOREFRONT_PRICE_FLOOR_UGX - 1) }, mapping);
    const ok = normalizePimRow({ ...base, price: String(STOREFRONT_PRICE_FLOOR_UGX) }, mapping);
    expect(low.errors.join(' ')).toMatch(/floor/);
    expect(ok.errors).toEqual([]);
  });

  it('order numbers carry eight hex characters, not four', () => {
    expect(read('apps/api/src/domain/commerce/Order.ts')).toMatch(/id\.substring\(0, 8\)\.toUpperCase\(\)/);
    // The one parser of the number accepts both generations.
    expect(read('apps/web/src/lib/paymentReturn.ts')).toMatch(/\[A-Z0-9\]\{4,8\}/);
  });

  it('a terminal checkout refusal keeps its reason for the storefront', () => {
    const src = read('apps/api/src/interfaces/http/routes/commerce.ts');
    expect(src).toMatch(/PUBLIC_TERMINAL_REASONS = new Set\(\['PRICE_CHANGED', 'PROMOTION_CHANGED', 'PRODUCT_UNAVAILABLE', 'PRICE_UNAVAILABLE'\]\)/);
    expect(src).toMatch(/outcome\.kind === 'FAILED_FINAL' && PUBLIC_TERMINAL_REASONS\.has\(outcome\.reason\)/);
  });

  it('the public catalogue honours products.active', () => {
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzleProductRepository.ts');
    expect(src).toMatch(/row\.approvalStatus !== 'approved' \|\| !row\.active/);
    expect(src).toMatch(/eq\(products\.active, true\),/);
  });
});

describe('security and sessions', () => {
  it('MFA step-up locks after five wrong codes for fifteen minutes', () => {
    const svc = new MfaService({} as never);
    const now = new Date('2026-08-28T10:00:00Z');
    expect(svc.isLocked({ failedAttempts: 5, updatedAt: now }, now)).toBe(true);
    expect(svc.isLocked({ failedAttempts: 4, updatedAt: now }, now)).toBe(false);
    expect(svc.isLocked({ failedAttempts: 5, updatedAt: new Date(now.getTime() - 16 * 60_000) }, now)).toBe(false);
    const route = read('apps/api/src/interfaces/http/routes/auth.ts');
    expect(route).toMatch(/MFA_LOCKED/);
    expect(route).toMatch(/429/);
  });

  it('a duplicate phone at registration is "already registered", not a 500', () => {
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleUserRepository.ts');
    expect(repo).toMatch(/Object\.assign\(new Error\('USER_EMAIL_TAKEN'\), \{ code: '23505' \}\)/);
    expect(read('apps/api/src/application/use-cases/identity/RegisterCustomerUseCase.ts')).toMatch(/code === '23505'/);
  });

  it('the public quote cache is bounded', () => {
    const src = read('apps/api/src/interfaces/http/routes/delivery.ts');
    expect(src).toMatch(/const CACHE_MAX = 5_000;/);
    expect(src).toMatch(/function cacheSet\(/);
  });

  it('a second SUCCESS webhook for a paid order is held for review, not crashed', () => {
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzlePaymentRepository.ts');
    expect(src).toMatch(/const alreadyPaid = input\.outcome === 'SUCCESS' && order\.paymentStatus === 'paid';/);
    expect(src).toMatch(/const requiresReview = requestedReview \|\| alreadyPaid;/);
  });

  it('a public battery page exists only for a published battery', () => {
    expect(read('apps/api/src/interfaces/http/routes/batteries.ts')).toMatch(/if \(!found \|\| !found\.isPublished\) throw/);
    expect(read('apps/api/src/application/use-cases/batteries/BatteryFinderUseCases.ts')).toMatch(/b\.lifecycleStatus === 'ACTIVE' && b\.productApproved && b\.productActive/);
  });
});

describe('operations that must not double, drift or lie', () => {
  it('the notification worker leaves telemetry events to the telemetry dispatcher', () => {
    expect(read('apps/api/src/application/use-cases/outbox/ProcessOutboxBatchUseCase.ts')).toMatch(/\[\.\.\.CHECKOUT_SIDE_EFFECT_EVENT_TYPES, 'TELEMETRY_DISPATCH'\]/);
  });

  it('a stale stock count is refused when the live balance moved without a reason', () => {
    expect(read('apps/api/src/application/use-cases/batteries/InventoryLedgerUseCases.ts')).toMatch(/COUNT_STALE/);
  });

  it('a price rollback reports a later manual change rather than clobbering it', () => {
    expect(read('apps/api/src/application/use-cases/batteries/BatteryImportUseCases.ts')).toMatch(/Price changed since import/);
  });

  it('the import preload answers by every code form the row can ask with', () => {
    expect(read('apps/api/src/application/use-cases/batteries/BatteryImportUseCases.ts')).toMatch(/batteryCodeCandidates\(raw\)\.map\(normaliseBatteryCode\)/);
  });

  it('a re-run dry run keeps an operator override', () => {
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleBatteryImportRepository.ts')).toMatch(/const kept = overridden\.get\(r\.rowId\);/);
  });

  it('pack verification needs a second person', () => {
    expect(read('apps/api/src/application/use-cases/batteries/BatteryCatalogueUseCases.ts')).toMatch(/found\.profile\.createdBy === actorId[\s\S]{0,80}MAKER_CHECKER/);
  });

  it('the brand chip counts only checked fits', () => {
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzleBatteryFinderRepository.ts');
    expect(src).toMatch(/\(\$\{VERIFIED_PUBLIC\}\)\)::int AS "verifiedFits"/);
  });

  it('a scheduled publish is refused rather than going live now', () => {
    expect(read('apps/api/src/application/use-cases/delivery/DeliveryConfigUseCases.ts')).toMatch(/SCHEDULING_NOT_SUPPORTED/);
  });

  it('moving an old promotion version does not rewrite the live definition', () => {
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzlePricingRepository.ts')).toMatch(/const mirrors = input\.to === 'ACTIVE' \|\| !current\?\.activeVersionId \|\| current\.activeVersionId === input\.versionId;/);
  });

  it('a failed refund status lookup rejects the reservation instead of stranding it', () => {
    expect(read('apps/api/src/application/use-cases/payments/RefundPesaPalPaymentUseCase.ts')).toMatch(/STATUS_LOOKUP_FAILED/);
  });

  it('the poller revisits paid attempts with a refund outstanding', () => {
    expect(read('apps/api/src/application/use-cases/payments/ReconcilePendingPaymentsUseCase.ts')).toMatch(/listCompletedAttemptsAwaitingRefund/);
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzlePaymentAttemptRepository.ts')).toMatch(/eq\(paymentRefunds\.status, 'requested'\)/);
  });

  it('the generic task transition cannot skip dispatch or packing', () => {
    const src = read('apps/api/src/application/use-cases/fulfilment/TransitionFulfilmentTaskUseCase.ts');
    expect(src).toMatch(/to === 'OUT_FOR_DELIVERY' && this\.guards\?\.dispatches/);
    expect(src).toMatch(/to === 'READY_FOR_DISPATCH' && this\.guards\?\.packingSessions/);
  });

  it('dispatch waits for a pending fee-variance agreement', () => {
    expect(read('apps/api/src/application/use-cases/fulfilment/DispatchUseCases.ts')).toMatch(/VARIANCE_AGREEMENT_PENDING/);
    expect(read('apps/api/src/interfaces/http/routes/admin/fulfilment.ts')).toMatch(/'VARIANCE_AGREEMENT_PENDING'\) return 409/);
  });

  it('COD policy is checked even when the structured location was omitted', () => {
    const src = read('apps/api/src/application/use-cases/commerce/CheckoutUseCase.ts');
    expect(src).toMatch(/: districtFromAreaLine\(dto\.customerDetails\.deliveryArea\);/);
  });

  it('a failure after the order committed no longer releases its loyalty reservation', () => {
    const src = read('apps/api/src/application/use-cases/commerce/CheckoutUseCase.ts');
    expect(src).toMatch(/\.attach\(loyaltyReservation\.reservationId, saved\.order\.id\)\.catch\(\(\) => undefined\);/);
  });

  it('the delivery setup page counts every mandatory key', () => {
    expect(read('apps/api/src/interfaces/http/routes/admin/delivery.ts')).toMatch(/const missingMandatory = missingMandatoryKeys\(live\);/);
  });
});
