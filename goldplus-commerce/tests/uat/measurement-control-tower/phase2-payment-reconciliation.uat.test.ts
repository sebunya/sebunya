import { describe, it, expect } from 'vitest';
import { readText, assertContains, assertMatches, collectMeasurementControlTowerFiles, assertNoPatternInFiles } from './helpers/phase2UatAssertions';

describe('Phase 2 UAT: PesaPal Payment Reconciliation', () => {
  it('PesaPal runbook states verified payment is the source of truth', () => {
    const text = readText('docs/measurement-control-tower/PESAPAL_RECONCILIATION_RUNBOOK.md');
    assertMatches(text, /source of truth/i, 'PesaPal verified webhook is truth');
  });

  it('PesaPal runbook states duplicate callbacks/IPNs must not double-count', () => {
    const text = readText('docs/measurement-control-tower/PESAPAL_RECONCILIATION_RUNBOOK.md');
    assertMatches(text, /duplicate/i, 'Must handle duplicate callbacks');
  });

  it('PesaPal runbook states manual purchase conversion is forbidden', () => {
    const text = readText('docs/measurement-control-tower/PESAPAL_RECONCILIATION_RUNBOOK.md');
    assertMatches(text, /manual.*forbidden|NEVER manually inject/i, 'Manual purchases forbidden');
  });

  it('pesapal-payment.test.ts contains a real assertion related to payment/reconciliation behavior', () => {
    const text = readText('tests/unit/pesapal-payment.test.ts');
    expect(text).not.toContain('expect(1).toBe(1)');
    expect(text).not.toContain('expect(true).toBe(true)');
    expect(text).toContain('expect(');
  });

  it('public docs/admin handover do not contain raw payment_token values', () => {
    const docs = collectMeasurementControlTowerFiles();
    assertNoPatternInFiles(docs, /payment_token=[a-zA-Z0-9]{10,}/, 'No raw tokens allowed');
  });

  it('public docs/admin handover do not contain provider secret values', () => {
    const docs = collectMeasurementControlTowerFiles();
    assertNoPatternInFiles(docs, /PESAPAL_SECRET=[a-zA-Z0-9]{10,}/, 'No provider secrets allowed');
  });
});
