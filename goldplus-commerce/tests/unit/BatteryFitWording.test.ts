import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UNCONDITIONAL_FIT_PROMISE, rewordFitPromise } from '../../apps/api/src/domain/batteries/BatteryFitWording';

/**
 * A battery listing offers the fit check; it never states it as done (2026-10-29 review of the guides: the 13 live
 * battery listings said "Fit confirmed before you pay." with no condition, while the shop checks a fit when asked).
 */
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('battery fit wording', () => {
  it('rewords the two unconditional sentences as offers, and nothing else', () => {
    expect(rewordFitPromise('Replacement battery for the Spark 4 and the A56, model GP-39LT9. Fit confirmed before you pay.'))
      .toBe('Replacement battery for the Spark 4 and the A56, model GP-39LT9. Not sure it fits? Ask us and we confirm it before you order.');
    expect(rewordFitPromise('Replacement phone battery, pack code 34DT/30VX. Match it to the code on your old battery; we confirm the fit before you pay.'))
      .toBe('Replacement phone battery, pack code 34DT/30VX. Match it to the code on your old battery, or ask us and we confirm the fit before you order.');
    // The long descriptions' offers ("bring your phone ... and we confirm") are the customer's to take up: kept.
    const offer = 'Sold new and sealed; bring your phone or the code printed on your old battery and we confirm the fit before you pay.';
    expect(rewordFitPromise(offer)).toBe(offer);
    expect(UNCONDITIONAL_FIT_PROMISE.test(offer)).toBe(false);
  });

  it('the seed data and the older rewording script cannot bring the bare promise back', () => {
    expect(read('apps/api/src/scripts/data/catalogue-copy-2026-09.json')).not.toMatch(UNCONDITIONAL_FIT_PROMISE);
    expect(read('apps/api/src/scripts/strip-tested-claim.ts')).not.toContain("' Fit confirmed before you pay.'");
    const script = read('apps/api/src/scripts/reword-battery-fit-promise.ts');
    expect(script).toContain("const apply = process.env.APPLY === '1';"); // dry run unless told
    expect(script).toContain("action: 'PRODUCT_DESCRIPTIONS_EDITED'");
  });
});
