import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

/** DoD #1 existed as a use case and a table (0051) that nothing ever called or wrote. */
describe('ledger reconciliation is wired', () => {
  it('a Drizzle repository implements the control-totals port, insert-only', () => {
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyControlTotalsRepository.ts');
    expect(repo).toMatch(/implements ILoyaltyControlTotalsRepository/);
    expect(repo).toMatch(/on conflict \(business_date\) do nothing/);
    expect(repo).not.toMatch(/update loyalty_daily_control_totals|delete from loyalty_daily_control_totals/i);
  });

  it('the Registry builds the use case and the daily sweep runs it and raises discrepancies', () => {
    expect(read('apps/api/src/infrastructure/Registry.ts')).toMatch(/new ReconcileLoyaltyControlTotalsUseCase\(new DrizzleLoyaltyControlTotalsRepository\(\)\)/);
    const ticker = read('apps/api/src/infrastructure/scheduler/LoyaltyDailyTicker.ts');
    expect(ticker).toMatch(/reconcileLoyaltyControlTotalsUseCase\.execute\(/);
    expect(ticker).toMatch(/LEDGER_CONTROL_TOTALS_DISCREPANCY/);
  });
});
