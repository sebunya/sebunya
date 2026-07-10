import { describe, it } from 'vitest';
import { readText, assertContains, assertNotContains, collectProductFinderFiles, assertNoPatternInFiles } from './helpers/phase2UatAssertions';

describe('Phase 2 UAT: Consent, Product Finder, and Preferences', () => {
  it('Preference Centre docs or source mention audit trail', () => {
    const text = readText('docs/measurement-control-tower/CONSENT_AND_PRIVACY_RUNBOOK.md');
    assertContains(text, 'audit trail', 'Preference Centre audit trail must be mentioned');
  });

  it('CONSENT_BLOCKED appears in relevant docs or source', () => {
    const text = readText('docs/measurement-control-tower/CONSENT_AND_PRIVACY_RUNBOOK.md');
    assertContains(text, 'CONSENT_BLOCKED', 'CONSENT_BLOCKED state must be documented');
  });

  it('consent-blocked is not described as FAILED in docs/source', () => {
    const text = readText('docs/measurement-control-tower/CONSENT_AND_PRIVACY_RUNBOOK.md');
    assertNotContains(text, 'FAILED', 'Consent blocked is not a failure');
  });

  it('Product Finder implementation does not import PurchaseMeasurementQueue', () => {
    const pfFiles = collectProductFinderFiles();
    assertNoPatternInFiles(pfFiles, /PurchaseMeasurementQueue/, 'Product Finder uses generic measurement, not purchase semantics');
  });

  it('Product Finder implementation does not map sessionId to orderId', () => {
    const pfFiles = collectProductFinderFiles();
    assertNoPatternInFiles(pfFiles, /orderId:.*sessionId/, 'Product Finder must not use purchase semantics');
  });

  it('Product Finder implementation does not map PRODUCT_FINDER to paymentReference', () => {
    const pfFiles = collectProductFinderFiles();
    assertNoPatternInFiles(pfFiles, /paymentReference:.*PRODUCT_FINDER/, 'Product Finder must not pollute payments');
  });

  it('Product Finder implementation does not import PesaPal reconciliation', () => {
    const pfFiles = collectProductFinderFiles();
    assertNoPatternInFiles(pfFiles, /PesaPal/, 'Product finder is isolated from payments');
  });

  it('Product Finder uses generic measurement queue or generic event semantics', () => {
    const pfFiles = collectProductFinderFiles();
    let found = false;
    for (const f of pfFiles) {
      if (readText(f).includes('GenericMeasurementQueue')) found = true;
    }
    if (!found) {
       for (const f of pfFiles) {
         if (readText(f).includes('MeasurementEvent')) found = true;
       }
    }
    if (!found) throw new Error('Product Finder must use generic measurement events');
  });

  it('WhatsApp intent/add-to-cart intent are described or represented as intent events, not verified purchases', () => {
    const text = readText('docs/measurement-control-tower/PRODUCT_FINDER_AND_ZERO_PARTY_DATA_RUNBOOK.md');
    assertContains(text, 'intent', 'Must be described as intent');
    assertNotContains(text, 'verified purchase', 'Intent is not verified purchase');
  });
});
