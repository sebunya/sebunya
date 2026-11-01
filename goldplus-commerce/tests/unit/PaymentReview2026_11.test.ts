import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const api = (p: string) => readFileSync(join(__dirname, '../../apps/api/src', p), 'utf8');

/**
 * Payment review 2026-11: wiring checks for fixes that live in the composition
 * root or in routes, where a behavioural test would need the whole container.
 */
describe('payment review 2026-11 wiring', () => {
  it('the payment-start order reader carries storeCreditAppliedUgx', () => {
    const src = api('infrastructure/Registry.ts');
    const start = src.indexOf('startOrderPaymentUseCase = new StartOrderPaymentUseCase');
    const block = src.slice(start, src.indexOf('attempts:', start));
    expect(block).toMatch(/storeCreditAppliedUgx:\s*order\.storeCreditAppliedUgx/);
  });
});
