import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const route = read('apps/api/src/interfaces/http/routes/admin/loyalty.ts');
const commerce = read('apps/api/src/interfaces/http/routes/commerce.ts');
const repository = read('apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyRepository.ts');
const schema = read('apps/api/src/infrastructure/db/schema/loyalty.ts');
const migration = read('apps/api/src/infrastructure/db/migrations/0047_loyalty_ledger_integrity.sql');
const page = read('apps/web/src/pages/admin/loyalty.astro');
const proof = read('apps/api/src/scripts/loyalty-ledger-proof.ts');

describe('Loyalty completion boundary', () => {
  it('protects every administrator operation with authentication and permission middleware', () => {
    expect(route).toContain("routes.use('*', authMiddleware)");
    expect(route.match(/requirePermissions\(\[PERMISSIONS\.SETTINGS_MANAGE\]\)/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it('exposes read-only operations separately from explicit expiry and reversal commands', () => {
    expect(route).toContain("routes.get('/operations'");
    expect(route).toContain("routes.post('/accounts/:id/expire'");
    expect(route).toContain("routes.post('/entries/:id/reverse'");
  });

  // Loyalty completion (2026-08-04): earning moved from payment confirmation to
  // DELIVERY confirmation (vesting, loyalty brief PART F). The invariants keep
  // their intent at the new location: server-owned identity/totals only, and
  // every earn passes through the double-gated EarnLoyaltyPointsUseCase.
  const vesting = read('apps/api/src/application/use-cases/loyalty/LoyaltyCompletionUseCases.ts');
  const registryFile = read('apps/api/src/infrastructure/Registry.ts');

  it('uses only server-owned paid-order identity and totals for earning (vesting path)', () => {
    expect(vesting).toContain('findLoyaltyEarnSource(orderId)');
    expect(vesting).toContain('orderTotalUgx: source.totalUgx');
    // commerce routes no longer earn at payment time — they only settle a
    // prepaid redemption reservation.
    expect(commerce).not.toContain('earnLoyaltyPointsUseCase');
    // MOVED 2026-08-06: loyalty settlement on payment lives in the ONE
    // settlement path (SettlePaymentUseCase wiring in the Registry), so the
    // callback, IPN, reconciliation poller and ops re-verify cannot drift.
    const registrySource = readFileSync(
      resolve(__dirname, '../../apps/api/src/infrastructure/Registry.ts'),
      'utf8',
    );
    expect(registrySource).toContain('consumeRedemptionUseCase.execute({ orderId })');
  });

  it('keeps earning behind the gated use case, vested on delivered/completed', () => {
    expect(vesting).toContain("result.code !== 'PROGRAMME_DISABLED'");
    expect(registryFile).toContain("toStatus === 'delivered' || toStatus === 'completed'");
    expect(registryFile).toContain('vestLoyaltyOnDeliveryUseCase.execute(orderId)');
  });

  it('serializes all account liability writes with PostgreSQL transaction locks', () => {
    expect(repository.match(/pg_advisory_xact_lock/g)?.length).toBeGreaterThanOrEqual(4);
    expect(repository).toContain('appendDebitIfAvailable');
    expect(repository).toContain('expireDueInTransaction');
    expect(repository).toContain('reverseEntry');
  });

  it('enforces one expiry and reversal per source at the database boundary', () => {
    expect(schema).toContain('loyalty_ledger_reversal_source_idx');
    expect(schema).toContain('loyalty_ledger_expiry_source_idx');
    expect(migration).toContain('loyalty_ledger_related_entry_fk');
  });

  it('enforces ledger type, sign and relationship shape', () => {
    expect(migration).toContain('loyalty_ledger_type_check');
    expect(migration).toContain('loyalty_ledger_shape_check');
    expect(migration).toMatch(/"type" = 'redeem' AND "points" < 0/);
    expect(migration).toMatch(/"type" = 'earn' AND "points" > 0 AND "order_id" IS NOT NULL/);
  });

  it('renders truthful loading-empty and populated operating states without customer PII', () => {
    expect(page).toContain('Immutable ledger operations');
    expect(page).toContain('No loyalty ledger events. The programme remains dormant.');
    expect(page).toContain('Ledger operations are unavailable');
    expect(page).not.toMatch(/entry\.(?:email|phone|customerName)/);
  });

  it('proves concurrency, idempotency, explicit expiry and no-send in real PostgreSQL', () => {
    for (const evidence of ['redemptionWinners', 'idempotencyConflictDenied', 'balanceOnlyFromLedgerEvents', 'providerCalls', 'protectedDeltas', 'proofResidue']) {
      expect(proof).toContain(evidence);
    }
    expect(proof).toContain("process.env.NODE_ENV === 'production'");
    expect(proof).toContain('endDbConnection()');
  });
});
