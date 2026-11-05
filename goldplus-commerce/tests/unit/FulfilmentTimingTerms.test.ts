import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { businessCutoffCountdown } from '../../apps/api/src/domain/delivery/DeliveryPresentation';
import { sameDayCutoffCopy } from '../../apps/web/src/lib/checkout';
import { deliveryFeeCell } from '../../apps/web/src/lib/money';
import { markdownMaxAgeSeconds } from '../../apps/web/src/lib/agentMarkdown';
import { saleStillRunning, type StorefrontDiscount } from '../../apps/web/src/lib/storefrontDiscount';
import { DELIVERY_FEE_TERMS, UPCOUNTRY_TERMS, sameDayDeliveryTerms } from '../../packages/shared/src/business';

/**
 * Visibility gaps A6 + N8 (2026-11-05). Owner decision: same-day dispatch AND delivery in Kampala and Wakiso on
 * orders before 5pm, Monday to Saturday. Kampala is UTC+3 with no DST, so the instants below are EAT - 3h.
 */
const eat = (iso: string) => new Date(`${iso}+03:00`);
const cut = (iso: string) => businessCutoffCountdown({ now: eat(iso), cutoffHour: 17, closedDays: [0] });

describe('the 5pm Kampala cut-off', () => {
  it('Thursday 16:59 is before, 17:00 and 17:01 are after', () => {
    expect(cut('2026-11-05T16:59:00')?.beforeCutoff).toBe(true);
    expect(cut('2026-11-05T16:59:00')?.minutesRemaining).toBe(1);
    expect(cut('2026-11-05T17:00:00')?.beforeCutoff).toBe(false);
    expect(cut('2026-11-05T17:01:00')?.beforeCutoff).toBe(false);
  });
  it('Saturday is a delivery day; Sunday is closed all day', () => {
    expect(cut('2026-11-07T10:00:00')?.beforeCutoff).toBe(true);
    const sunday = cut('2026-11-08T09:00:00');
    expect(sunday?.beforeCutoff).toBe(false);
    expect(sunday?.sentence).toMatch(/do not dispatch today/);
  });
  it('after Saturday 5pm the next run is named Monday, not "tomorrow"', () => {
    const copy = sameDayCutoffCopy({ closed: false, beforeCutoff: false, minsToCutoff: 0 }, { now: eat('2026-11-07T17:30:00'), closedDays: [0] });
    expect(copy.inArea).toBe("Today's run has left. This goes out on Monday morning");
  });
  it('outside Kampala and Wakiso no same-day promise is made', () => {
    const copy = sameDayCutoffCopy({ closed: false, beforeCutoff: true, minsToCutoff: 200 });
    expect(copy.outside).toBe('Same-day dispatch and delivery is for Kampala & Wakiso. We confirm your delivery day by phone');
  });
});

describe('fee semantics: an unknown fee is never free', () => {
  it('a priced fee shows the amount', () => expect(deliveryFeeCell(6500, true)).toMatch(/^UGX 6,500$/));
  it('pickup or a waiver (0, confirmed) is free', () => expect(deliveryFeeCell(0, true)).toBe('Free'));
  it('an address that could not be priced (0, unconfirmed) is to be agreed, not free', () => {
    expect(deliveryFeeCell(0, false)).toBe('To be agreed by phone');
  });
  it('one wording names the binding moment and the unpriced path', () => {
    expect(DELIVERY_FEE_TERMS).toMatch(/shown at checkout before you pay, and that is the fee you are charged/);
    expect(DELIVERY_FEE_TERMS).toMatch(/by phone before dispatch/);
    expect(UPCOUNTRY_TERMS).toMatch(/bus to a parcel office/);
    expect(sameDayDeliveryTerms('5pm', 'Monday to Saturday')).toBe(
      'Order before 5pm, Monday to Saturday, and it is dispatched and delivered the same day in Kampala and Wakiso; later orders go on the next working day.',
    );
  });
  it('no public surface keeps the old "confirmed before the rider leaves" or dispatch-only buying line', () => {
    const files = [
      'apps/web/src/pages/faq.astro', 'apps/web/src/pages/[hub]/[...child].astro', 'apps/web/src/lib/assistantRouter.ts',
      'apps/web/src/lib/agentDocuments.ts', 'apps/web/src/pages/delivery/kampala-wakiso.astro', 'apps/web/src/lib/agentTools.ts',
      'apps/web/src/pages/llms.txt.ts', 'apps/web/src/pages/shop.astro', 'apps/web/src/pages/wa.astro', 'apps/web/src/lib/phoneBatteryPage.ts',
    ];
    for (const f of files) {
      const src = readFileSync(join(__dirname, '../..', f), 'utf8');
      expect(src, f).not.toMatch(/confirmed before the rider leaves|go out the same day in Kampala|When they arrive depends on the area|Same-day dispatch in Kampala and Wakiso\.|same-day dispatch in Kampala and Wakiso, or/);
    }
  });
});

describe('sale end at a Kampala midnight', () => {
  const sale: StorefrontDiscount = { active: true, percent: 10, percentBps: 1000, endsIso: '2026-11-30T21:00:00.000Z', name: 'x', priceFloorUgx: 0 };
  const midnight = eat('2026-12-01T00:00:00').getTime();
  it('the display stops at the instant the evaluator stops ([start, end))', () => {
    expect(saleStillRunning(sale, midnight - 1)).toBe(true);
    expect(saleStillRunning(sale, midnight)).toBe(false);
    expect(saleStillRunning({ ...sale, endsIso: null }, midnight)).toBe(true);
  });
  it('Markdown is not cached past the sale end', () => {
    expect(markdownMaxAgeSeconds(null)).toBe(900);
    expect(markdownMaxAgeSeconds(sale.endsIso, new Date(midnight - 120_000))).toBe(120);
    expect(markdownMaxAgeSeconds(sale.endsIso, new Date(midnight + 5_000))).toBe(0);
    expect(markdownMaxAgeSeconds(sale.endsIso, new Date(midnight - 86_400_000))).toBe(900);
  });
});

describe('N7: a re-cased product link', () => {
  it('folds to the lower-case slug with one 301, only when that product exists, before the recorded-redirect lookup', () => {
    const src = readFileSync(join(__dirname, '../../apps/web/src/pages/products/[slug].astro'), 'utf8');
    const fold = src.indexOf("const folded = (slug ?? '').toLowerCase();");
    expect(fold).toBeGreaterThan(-1);
    expect(src.slice(fold, fold + 500)).toMatch(/if \(lc\?\.ok\) return Astro\.redirect\(carryQuery\(`\/products\/\$\{folded\}`, Astro\.url\.search\), 301\);/);
    expect(fold).toBeLessThan(src.indexOf('const recorded = await findRecordedRedirect(Astro.url.pathname);'));
  });
});
