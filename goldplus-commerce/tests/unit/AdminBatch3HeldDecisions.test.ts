import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { isShadowablePath, isAllowedShadowHost, shadowSafeHeaders } from '../../apps/api/src/infrastructure/deployment/DeploymentService';
import { requiresMfa } from '../../apps/api/src/domain/identity/MfaPolicy';
import { stockCountApplyRefusal, stockReceiptApplyRefusal } from '../../apps/api/src/domain/batteries/StockImportApplyGuard';

/**
 * Owner-approved held decisions (2026-09-24), batch 3:
 *  #3  shadow-traffic target restricted to internal hosts; credentials never forwarded
 *  #9  refunds need a fresh MFA step-up, like pricing approval
 *  #10 a stock import applied after stock moved since its dry run is refused
 */

describe('#3 shadow traffic never leaves our hosts or carries an identity', () => {
  it('refuses an internet host as the target', () => {
    expect(isAllowedShadowHost('attacker.example.com', {})).toBe(false);
    expect(isAllowedShadowHost('shadow-api', {})).toBe(true);
  });
  it('never mirrors customer-scoped paths (cart, checkout, account, consent, telemetry)', () => {
    for (const p of ['/commerce/cart', '/commerce/checkout/intent', '/account/orders', '/consent/preferences', '/telemetry/collect', '/measurement/events', '/auth/login', '/admin/users']) {
      expect(isShadowablePath(p), p).toBe(false);
    }
    expect(isShadowablePath('/products/power-bank-20000')).toBe(true);
  });
  it('strips credentials from mirrored headers', () => {
    expect(shadowSafeHeaders({ authorization: 'Bearer x', cookie: 'a=b', 'x-goldplus-internal-key': 'k', accept: '*/*' })).toEqual({ accept: '*/*' });
  });
});

describe('#9 refunds require a fresh second factor', () => {
  it('payment_refund is an MFA-required action', () => {
    expect(requiresMfa('payment_refund')).toBe(true);
  });
  it('the refund route carries requireStepUp, and the admin has a screen to verify', () => {
    const route = readFileSync('apps/api/src/interfaces/http/routes/admin/payments.ts', 'utf8');
    expect(route).toMatch(/'\/attempts\/:merchantReference\/refund', requirePermissions\(\[PERMISSIONS\.PAYMENTS_REFUND\]\), requireStepUp\('payment_refund'\)/);
    const page = readFileSync('apps/web/src/pages/admin/security/mfa.astro', 'utf8');
    for (const endpoint of ['mfa/status', 'call("enrol"', 'call("confirm"', 'call("verify"']) expect(page).toContain(endpoint);
    expect(readFileSync('apps/web/src/lib/admin-navigation.ts', 'utf8')).toContain("href: '/admin/security/mfa'");
  });
});

describe('#10 stock imports are re-checked at apply', () => {
  it('a count previewed at 4 is refused when stock is now 2', () => {
    expect(stockCountApplyRefusal({ systemQuantityAtPreview: 4, liveStock: 2 })).toMatchObject({ code: 'COUNT_STALE' });
  });
  it('an unchanged stock applies', () => {
    expect(stockCountApplyRefusal({ systemQuantityAtPreview: 4, liveStock: 4 })).toBeNull();
  });
  it('a receipt applied by another session since the preview is refused', () => {
    expect(stockReceiptApplyRefusal({ alreadyApplied: true, quantity: 10, reference: 'INV-9' })).toMatchObject({ code: 'DUPLICATE_RECEIPT' });
    expect(stockReceiptApplyRefusal({ alreadyApplied: false, quantity: 10, reference: 'INV-9' })).toBeNull();
  });
  it('applyRow runs both guards before posting a movement', () => {
    const uc = readFileSync('apps/api/src/application/use-cases/batteries/BatteryImportUseCases.ts', 'utf8');
    const receipt = uc.slice(uc.indexOf("case 'STOCK_RECEIPT': {\n        // Re-checked"), uc.indexOf("case 'STOCK_COUNT': {\n        // The count"));
    expect(receipt.indexOf('stockReceiptApplyRefusal')).toBeLessThan(receipt.indexOf('recordMovement'));
    const count = uc.slice(uc.indexOf("case 'STOCK_COUNT': {\n        // The count"), uc.indexOf("case 'PRICE_UPDATE'"));
    expect(count.indexOf('stockCountApplyRefusal')).toBeGreaterThan(-1);
    expect(count.indexOf('stockCountApplyRefusal')).toBeLessThan(count.indexOf('recordMovement'));
  });
});
