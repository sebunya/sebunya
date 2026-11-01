import { describe, expect, it } from 'vitest';
import {
  availableBalance, checkIssue, creditToApply, maskCreditCode, newCreditCode, normalizeCreditCode,
} from '../../apps/api/src/domain/credit/CreditInstrument';

const R = [3, 17, 25, 9, 0, 31, 12, 7, 22, 14, 5];

describe('credit instruments (gap #17)', () => {
  it('a balance is its ledger: released holds do not count, captured and held ones do', () => {
    expect(availableBalance([
      { type: 'ISSUE', amountUgx: 100_000 },
      { type: 'HOLD', amountUgx: -30_000, holdState: 'captured' },
      { type: 'HOLD', amountUgx: -20_000, holdState: 'held' },
      { type: 'HOLD', amountUgx: -50_000, holdState: 'released' },
      { type: 'RETURN', amountUgx: 10_000 },
    ])).toBe(60_000);
    expect(availableBalance([{ type: 'ISSUE', amountUgx: 10_000 }, { type: 'VOID', amountUgx: -10_000 }])).toBe(0);
  });

  it('credit never exceeds the balance or what is owed', () => {
    expect(creditToApply({ balanceUgx: 50_000, amountDueUgx: 120_000 })).toBe(50_000);
    expect(creditToApply({ balanceUgx: 500_000, amountDueUgx: 120_000 })).toBe(120_000);
    expect(creditToApply({ balanceUgx: 50_000, amountDueUgx: 120_000, requestedUgx: 20_000 })).toBe(20_000);
    expect(creditToApply({ balanceUgx: 0, amountDueUgx: 120_000 })).toBe(0);
  });

  it('codes carry their kind and a check symbol; a typo is refused, a misread 0/O and 1/I/L is forgiven', () => {
    const code = newCreditCode('gift_card', R);
    expect(code).toMatch(/^GPGC-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(normalizeCreditCode(code)).toEqual({ code, kind: 'gift_card' });
    expect(normalizeCreditCode(code.toLowerCase().replace(/-/g, ' '))).toEqual({ code, kind: 'gift_card' });
    const typo = code.slice(0, 6) + (code[6] === 'A' ? 'B' : 'A') + code.slice(7);
    expect(normalizeCreditCode(typo)).toBeNull();
    expect(normalizeCreditCode(newCreditCode('store_credit', R))?.kind).toBe('store_credit');
    const withZero = newCreditCode('gift_card', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(normalizeCreditCode(withZero.replace(/0/g, 'O'))?.code).toBe(withZero);
    expect(normalizeCreditCode('GPXX-1234-5678-9ABC')).toBeNull();
  });

  it('only the last four symbols are ever shown after issue', () => {
    expect(maskCreditCode('GPGC-ABCD-EFGH-JK12')).toBe('GPGC-••••-••••-JK12');
  });

  it('issue rules: a reason, at least UGX 1,000, at most 5,000,000, a second approver above 500,000', () => {
    expect(checkIssue({ amountUgx: 50_000, reason: 'Sold at the counter' })).toEqual({ ok: true, needsSecondApproval: false });
    expect(checkIssue({ amountUgx: 600_000, reason: 'Refund for GP-1' })).toEqual({ ok: true, needsSecondApproval: true });
    expect(checkIssue({ amountUgx: 500, reason: 'x x x x x' })).toMatchObject({ ok: false, code: 'BAD_AMOUNT' });
    expect(checkIssue({ amountUgx: 6_000_000, reason: 'big order' })).toMatchObject({ ok: false, code: 'TOO_LARGE' });
    expect(checkIssue({ amountUgx: 10_000, reason: '' })).toMatchObject({ ok: false, code: 'NEEDS_REASON' });
  });
});
