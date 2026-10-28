import fs, { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { learnLandmarks, LANDMARK_MIN_SESSIONS } from '../../apps/api/src/domain/locations/LandmarkLearning';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('storefront orders are paid online (owner decision 2026-10-16)', () => {
  it('checkout offers only Pay now, and always sends the online method', () => {
    const page = read('apps/web/src/pages/checkout.astro');
    expect(page).not.toMatch(/name="paymentMethod" value="offline"/);
    expect(page).toMatch(/name="paymentMethod" value="pesapal" checked/);
    expect(page).toMatch(/const paymentMethod = 'pesapal';/);
  });

  it('the server refuses pay on delivery unless STOREFRONT_PAY_ON_DELIVERY=on, with the existing refusal code', () => {
    expect(read('apps/api/src/application/use-cases/commerce/CheckoutUseCase.ts')).toMatch(/dto\.paymentMethod !== 'pesapal' && this\.payOnDelivery && !this\.payOnDelivery\.allowed\(\)/);
    expect(read('apps/api/src/infrastructure/Registry.ts')).toMatch(/STOREFRONT_PAY_ON_DELIVERY \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'on'/);
  });

  it('no customer-facing page or message still offers pay on delivery', () => {
    for (const f of [
      'apps/web/src/pages/checkout.astro', 'apps/web/src/lib/checkoutClient.ts', 'apps/web/src/lib/paymentReturn.ts', 'apps/web/src/pages/track-order.astro',
      'apps/web/src/lib/agentDocuments.ts', 'apps/web/src/lib/assistantRouter.ts',
      // Missed until 2026-10-29: the FAQ, every product page and the payment-cancelled page still offered it.
      'apps/web/src/pages/faq.astro', 'apps/web/src/pages/products/[slug].astro', 'apps/web/src/pages/checkout/pesapal/cancelled.astro',
    ]) {
      const customerStrings = (read(f).match(/(['`"])(?:(?!\1).){12,}\1/g) ?? []).join('\n');
      expect(customerStrings, f).not.toMatch(/pay on delivery|pay at (the|our) shop/i);
    }
    // The offline option's wording is admin-editable copy: no public page may render it while checkout is online only.
    for (const f of ['apps/web/src/pages/faq.astro', 'apps/web/src/pages/products/[slug].astro']) expect(read(f), f).not.toMatch(/payment\.offline/);
  });

  it('no published guide offers pay on delivery or paying at the shop', () => {
    const dir = path.resolve(__dirname, '../../docs/content/guides');
    for (const f of fs.readdirSync(dir).filter((n) => /^\d+-.*\.md$/.test(n))) {
      expect(fs.readFileSync(path.join(dir, f), 'utf8'), f).not.toMatch(/pay(ing)? on delivery|pay (nothing today|when (your order|it) reaches you)|pay now or on delivery/i);
    }
  });
});

describe('places our map does not know: no dead end, and the shop learns them', () => {
  const r = (q: string, area: string, visitor: string) => ({ normalisedQuery: q.toLowerCase(), rawQuery: q, areaSlug: area, visitor });

  it('learns a landmark when enough different visitors agree on its area', () => {
    const rows = [
      r('parliament', 'kampala-central-1', 's1'), r('Parliament', 'kampala-central-1', 's2'), r('parliament', 'kampala-central-1', 's3'),
      r('parliament', 'kampala-nakasero-2', 's4'),
    ];
    expect(learnLandmarks(rows, new Set())).toEqual([{ name: 'Parliament', areaSlug: 'kampala-central-1', visitors: 3, share: 0.75 }]);
  });

  it('does not learn from too few visitors, split answers, one visitor repeating, numbers, or known names', () => {
    expect(learnLandmarks([r('vine international', 'a-1', 's1'), r('vine international', 'a-1', 's2')], new Set())).toEqual([]);
    expect(learnLandmarks([r('acacia mall', 'a-1', 's1'), r('acacia mall', 'a-1', 's2'), r('acacia mall', 'b-2', 's3'), r('acacia mall', 'b-2', 's4')], new Set())).toEqual([]);
    expect(learnLandmarks(Array.from({ length: 6 }, () => r('my gate', 'a-1', 'same')), new Set())).toEqual([]);
    expect(learnLandmarks(Array.from({ length: 4 }, (_, i) => r('0772 123 456', 'a-1', `s${i}`)), new Set())).toEqual([]);
    expect(learnLandmarks(Array.from({ length: 4 }, (_, i) => r('garden city', 'a-1', `s${i}`)), new Set(['garden city']))).toEqual([]);
    expect(LANDMARK_MIN_SESSIONS).toBe(3);
  });

  it('the picker turns a miss into ways forward, carries the words to the rider line, and reports the answer', () => {
    const client = read('apps/web/src/lib/locationPickerClient.ts');
    expect(client).toMatch(/is not on our map yet\. Pick its area, and we will tell the rider to look for it\./);
    expect(client).toMatch(/action: 'locate'/);
    expect(client).toMatch(/action: 'fallbacks'/);
    expect(client).toMatch(/resolvedVia: 'landmark', sessionId: searchSession/);
    expect(read('apps/web/src/pages/checkout.astro')).toMatch(/addEventListener\('gp:place-typed'/);
    expect(read('scripts/delivery-nightly.sh')).toMatch(/run landmarks\s+geo-nightly-learn-landmarks\.js/);
  });

  it('suggestions spell the place the way the gazetteer does, and say which landmark matched', () => {
    const client = read('apps/web/src/lib/locationPickerClient.ts');
    expect(client).toMatch(/matchedAs: h\.viaAlias \? h\.viaAlias :/);
    expect(client).toMatch(/opt\.viaLandmark \? `for \$\{opt\.viaLandmark\}`/);
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleLocationSearchRepository.ts')).toMatch(/al\.alias as via_alias/);
  });

  it('saved addresses are named by area and never repeat the district', () => {
    const page = read('apps/web/src/pages/checkout.astro');
    expect(page).toMatch(/a\.label && a\.label !== a\.district \? a\.label/);
    expect(page).toMatch(/never "Najjera, Wakiso, Wakiso"/);
  });
});

describe('checkout small print (owner 2026-10-16)', () => {
  const page = read('apps/web/src/pages/checkout.astro');
  it('with one pickup point, collection is simply our GoldPlus shop: no dropdown, the shop chosen underneath', () => {
    expect(page).toMatch(/pickupPoints\.length === 1 \? 'I\\'ll collect from our GoldPlus shop'/);
    expect(page).toMatch(/data-single=\{pickupPoints\.length === 1 \? '1' : undefined\}/);
    expect(page).toMatch(/selected=\{pickupPoints\.length === 1 \|\| p\.id === values\.pickupPointId\}/);
    expect(page).toMatch(/pickupSelect\?\.classList\.toggle\('hidden', single \|\| !pickup\)/);
  });
  it('"How did you hear about us?" opens on a neutral line and ends with "Prefer not to say"', () => {
    const sel = page.slice(page.indexOf('<select id="heardAbout"'), page.indexOf('</select>', page.indexOf('<select id="heardAbout"')));
    const options = sel.match(/>([^<>{}]+)<\/option>/g) ?? [];
    expect(options[0]).toBe('>Choose an answer</option>');
    expect(options[options.length - 1]).toBe('>Prefer not to say</option>');
  });
});
