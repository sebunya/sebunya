import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flashSaleIsLive } from '../../apps/api/src/infrastructure/db/repositories/DrizzleFlashSaleRepository';
import { reviewAggregateLockKey } from '../../apps/api/src/infrastructure/db/repositories/DrizzleReviewRepository';
import { resolveRowOutcome } from '../../apps/api/src/infrastructure/db/repositories/DrizzleBatteryImportRepository';
import { followMerge } from '../../apps/api/src/infrastructure/db/repositories/DrizzleBatteryFinderRepository';
import { isUniqueViolation } from '../../apps/api/src/infrastructure/db/pgErrors';

const repo = (f: string) => readFileSync(join(__dirname, '../../apps/api/src/infrastructure/db/repositories', f), 'utf8');

describe('2026-11 review 235: repositories', () => {
  it('a flash sale reserves only while scheduled/live and inside its window', () => {
    const sale = { status: 'scheduled', startsAt: new Date('2026-11-01T00:00:00Z'), endsAt: new Date('2026-11-02T00:00:00Z') };
    expect(flashSaleIsLive(sale, new Date('2026-11-01T12:00:00Z'))).toBe(true);
    expect(flashSaleIsLive({ ...sale, status: 'cancelled' }, new Date('2026-11-01T12:00:00Z'))).toBe(false);
    expect(flashSaleIsLive({ ...sale, status: 'ended' }, new Date('2026-11-01T12:00:00Z'))).toBe(false);
    expect(flashSaleIsLive(sale, new Date('2026-10-31T23:59:59Z'))).toBe(false);
    expect(flashSaleIsLive(sale, new Date('2026-11-02T00:00:00Z'))).toBe(false);
    expect(repo('DrizzleFlashSaleRepository.ts')).toContain("throw new FlashGate('SALE_NOT_LIVE')");
  });

  it('the rating recompute takes a per-product advisory lock', () => {
    expect(reviewAggregateLockKey('p1')).toBe('review-aggregate:p1');
    expect(repo('DrizzleReviewRepository.ts')).toMatch(/pg_advisory_xact_lock\(hashtext\(\$\{reviewAggregateLockKey\(productId\)\}\)\)/);
  });

  it('BusinessInfo, Nav and Hero saves upsert the singleton row', () => {
    for (const f of ['DrizzleBusinessInfoRepository.ts', 'DrizzleNavRepository.ts', 'DrizzleHeroRepository.ts']) {
      expect(repo(f)).toMatch(/on conflict \(id\) do update/);
    }
    expect(repo('DrizzleNavRepository.ts')).toContain('where nav_config.version = ${expectedVersion}');
  });

  it('Include on a compound or conflicting row with no override stays held', () => {
    expect(resolveRowOutcome({ resolution: 'INCLUDE', proposedAction: 'HOLD_COMPOUND', hasErrors: false, hasOverride: false })).toEqual({ status: 'HELD', action: 'HOLD_COMPOUND' });
    expect(resolveRowOutcome({ resolution: 'INCLUDE', proposedAction: 'HOLD_CONFLICT', hasErrors: false, hasOverride: false })).toEqual({ status: 'HELD', action: 'HOLD_CONFLICT' });
    expect(resolveRowOutcome({ resolution: 'INCLUDE', proposedAction: 'HOLD_COMPOUND', hasErrors: false, hasOverride: true })).toEqual({ status: 'VALID', action: 'CREATE_BATTERY' });
    expect(resolveRowOutcome({ resolution: 'INCLUDE', proposedAction: 'HOLD_REVIEW', hasErrors: false, hasOverride: false })).toEqual({ status: 'VALID', action: 'RECEIPT' });
    expect(resolveRowOutcome({ resolution: 'EXCLUDE', proposedAction: 'CREATE_BATTERY', hasErrors: false, hasOverride: false }).status).toBe('EXCLUDED');
    expect(repo('DrizzleBatteryImportRepository.ts')).toContain('override || actionChanged');
  });

  it('receipt lines change only on an unclaimed DRAFT', () => {
    const s = repo('DrizzleInventoryLedgerRepository.ts');
    const fn = s.slice(s.indexOf('async updateReceiptLines'), s.indexOf('async claimReceiptForApply'));
    expect(fn).toContain("eq(stockReceipts.status, 'DRAFT'), isNull(stockReceipts.appliedBy)");
    expect(fn.indexOf('isNull(stockReceipts.appliedBy)')).toBeLessThan(fn.indexOf('tx.delete(stockReceiptLines)'));
  });

  it('a creator refund reverses the coupon with no commission, and a payout run keeps to its period', () => {
    const s = repo('DrizzleCreatorRepository.ts');
    expect(s).not.toContain('if (updated.length === 0) return { reversed: false };');
    expect(s).toContain('payoutPeriodSql(creatorCommissions.createdAt, input.periodStart, input.periodEnd)');
  });

  it('the commercial funnel counts delivered orders', () => {
    const s = repo('DrizzleRecommendationCommercialRepository.ts');
    expect(s).toContain("o.status in ('dispatched', 'delivered', 'completed')");
    expect(s).toContain("o.status in ('delivered', 'completed'))::int as completed");
  });

  it('a profile projection is a change when only the account link or preferences moved', () => {
    const s = repo('DrizzleCustomerDnaRepositories.ts');
    expect(s).toContain('${customerProfiles.accountUserId} is distinct from');
    expect(s).toContain('${asJson(customerProfiles.communicationPreferences)} is distinct from');
  });

  it('removing a legacy cover promotes a survivor and moves the product image projection', () => {
    const s = repo('DrizzleProductImageRepository.ts');
    expect(s).toContain('set({ isPrimary: true })');
    expect(s).toContain('imageUrl: survivor?.url ?? null, hasImage: !!survivor');
  });

  it('cap list: product save leaves the gallery projection alone', () => {
    const s = repo('DrizzleProductRepository.ts');
    const set = s.slice(s.indexOf('onConflictDoUpdate({', s.indexOf('async save(')), s.indexOf('async findAll'));
    expect(set).not.toContain('imageUrl: product.imageUrl');
    expect(set).not.toContain('hasImage: product.hasImage');
  });

  it('cap list: NON_STOCK_ITEM products count as available', () => {
    expect(repo('DrizzleProductRepository.ts')).toContain("${products.inventoryPolicy} = 'NON_STOCK_ITEM'");
    expect(repo('DrizzleProductRecommendationReader.ts')).toContain("${products.inventoryPolicy} = 'NON_STOCK_ITEM'");
  });

  it('cap list: the PURCHASE_COUNT dry run counts what the live mission counts', () => {
    const s = repo('DrizzleGamificationRepository.ts');
    const dry = s.slice(s.indexOf('async dryEvaluate'), s.indexOf("mission.kind === 'REVIEW_COUNT'", s.indexOf('async dryEvaluate')));
    expect(dry).toContain('LOYALTY_PAYMENT_QUALIFIES_SQL');
    expect(dry).toContain("in ('delivered','completed')");
  });

  it('cap list: updateQuery swallows only a unique violation', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ message: 'x', cause: { code: '23505' } })).toBe(true);
    expect(isUniqueViolation(new Error('connection refused'))).toBe(false);
    expect(repo('DrizzleAiVisibilityRepository.ts')).toContain('if (isUniqueViolation(err)) return null;');
  });

  it('cap list: the abandonment subtotal takes one price row per item', () => {
    const s = repo('DrizzleAbandonmentRepository.ts');
    expect(s).not.toContain('leftJoin(productPrices');
    expect(s).toContain('limit 1');
  });

  it('cap list: the finder merge recursion stops on a cycle', () => {
    expect(followMerge(new Set(), 'a', 'b')).toBe(true);
    expect(followMerge(new Set(['b']), 'a', 'b')).toBe(false);
    expect(followMerge(new Set(), 'a', 'a')).toBe(false);
    expect(followMerge(new Set(['1', '2', '3', '4', '5', '6', '7', '8']), 'a', 'z')).toBe(false);
  });
});
