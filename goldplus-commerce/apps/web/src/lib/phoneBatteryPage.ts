import type { FinderBatteryResultDto, FinderDeviceDto } from '@goldplus/shared';
import { SITE_ORIGIN } from './sitemap';

/**
 * The per-phone battery page (/phone-batteries/<device-slug>), the one URL a
 * search for "<phone> battery" can land on. Pure rules here, rendered by
 * pages/phone-batteries/[device].astro, so the title, the index decision and
 * the structured data are unit-tested without a browser.
 *
 * Organic programme 2026-10-28 (docs/growth): the finder's ?device= view was
 * noindex and canonicalised to the bare finder, so no phone-specific URL
 * existed for Google to show. This page is indexable only while the phone has
 * at least one battery a customer can buy; a page with nothing to sell is kept
 * (it carries the request form) but noindex, never a thin promise.
 */

export const PHONE_BATTERY_PATH = '/phone-batteries';

export function phoneBatteryPath(deviceSlug: string): string {
  return `${PHONE_BATTERY_PATH}/${deviceSlug}`;
}

/** Device slugs are lowercase kebab, as the finder issues them; anything else is not a page. */
export function isDeviceSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 160;
}

/** Indexable while there is something to buy. Out-of-stock verified fits still count: the page is still the right answer. */
export function phonePageIndexable(results: ReadonlyArray<Pick<FinderBatteryResultDto, 'fitState'>>): boolean {
  return results.length > 0;
}

export function phonePageTitle(device: Pick<FinderDeviceDto, 'label'>): string {
  return `${device.label} battery replacement in Kampala | GoldPlus`;
}

export function phonePageH1(device: Pick<FinderDeviceDto, 'label'>): string {
  return `Replacement battery for the ${device.label}`;
}

const ugx = (n: number): string => `UGX ${n.toLocaleString('en-UG')}`;

/** One honest sentence: how many, the code(s), the price, and where the fit comes from. */
export function phonePageDescription(
  device: Pick<FinderDeviceDto, 'label' | 'verifiedFits'>,
  results: ReadonlyArray<Pick<FinderBatteryResultDto, 'canonicalCode' | 'priceUgx' | 'fitState'>>,
): string {
  if (results.length === 0) {
    return `We have not matched a battery to the ${device.label} yet. Tell us the model number, or send a photo of the old battery's label, and we check it.`;
  }
  const codes = [...new Set(results.map((r) => r.canonicalCode))].slice(0, 3).join(', ');
  const prices = results.map((r) => r.priceUgx).filter((p): p is number => typeof p === 'number' && p > 0);
  const price = prices.length ? ` from ${ugx(Math.min(...prices))}` : '';
  const provenance = results.every((r) => r.fitState === 'AWAITING_VERIFICATION')
    ? "listed by our supplier for this phone"
    : 'checked for this phone';
  // "Dispatch", never "arrives": the day's run is a condition the page body states (docs/growth/README.md §5).
  return `Replacement battery for the ${device.label}: pack code ${codes}${price}, ${provenance}. Order online for same-day dispatch in Kampala and Wakiso, or collect at the shop.`;
}

/**
 * The cart's "Buying for your <phone>" sentence. `matched` counts every battery
 * line with a public fit for the phone; `listed` the ones whose fit comes from
 * the supplier's list. Never says "checked" for a fit we did not check.
 */
export function cartDeviceFitNote(matched: number, listed: number): string {
  if (matched === 0) return 'None of the batteries in your cart are matched to this phone yet.';
  const items = `${matched} item${matched === 1 ? '' : 's'} in your cart`;
  if (listed === 0) return `${items} ${matched === 1 ? 'has' : 'have'} been checked by us against this phone.`;
  const source = listed === matched ? "from our supplier's compatibility list" : `${listed} of them from our supplier's compatibility list`;
  return `${items} ${matched === 1 ? 'fits' : 'fit'} this phone, ${source}. Not sure? Message us and we confirm it before you order.`;
}

export interface PhoneGuideLink { label: string; href: string }

/**
 * The guides that answer this brand's questions, most specific first. Slugs are
 * the published blog slugs (docs/content/guides 01, 05, 10, 11, 12, 14).
 */
export function phoneGuides(brandName: string): PhoneGuideLink[] {
  const b = brandName.toLowerCase();
  const out: PhoneGuideLink[] = [];
  if (b === 'tecno') out.push({ label: 'Tecno battery codes (BL-) explained', href: '/blog/tecno-battery-codes-bl-explained' });
  if (b === 'infinix' || b === 'itel') out.push({ label: 'Finding a battery for Infinix and itel phones', href: '/blog/finding-the-right-battery-for-infinix-and-itel-phones' });
  if (b === 'apple' || b === 'iphone') out.push({ label: 'Replacing an iPhone battery: what to know', href: '/blog/replacing-an-iphone-battery-what-to-know-before-you-do-it' });
  out.push({ label: 'How to find the right replacement battery', href: '/blog/how-to-find-the-right-replacement-battery-for-your-phone' });
  out.push({ label: 'How to read a battery label', href: '/blog/how-to-read-the-code-and-ratings-on-a-phone-battery-label' });
  out.push({ label: 'A swollen battery: what to do', href: '/blog/a-swollen-phone-battery-what-to-do-safety-first' });
  return out;
}

export interface BatteryJsonLdFacts {
  canonicalCode: string;
  capacityMah: number | null;
  nominalVoltageMv: number | null;
  devices: Array<{ label: string; modelNumber: string | null }>;
}

/**
 * What a battery's own Product node adds (components/ProductJsonLd.astro): the
 * pack code (as mpn only when the product has no model number of its own),
 * capacity and voltage only when recorded, and the phones it is published as
 * fitting as `isAccessoryOrSparePartFor`. Nothing absent is filled in.
 */
export function batteryProductJsonLdProps(battery: BatteryJsonLdFacts, hasOwnMpn: boolean): {
  mpn?: string;
  additionalProperty: Array<Record<string, unknown>>;
  isAccessoryOrSparePartFor?: Record<string, unknown> | Array<Record<string, unknown>>;
} {
  const additionalProperty: Array<Record<string, unknown>> = [{ '@type': 'PropertyValue', name: 'Battery pack code', value: battery.canonicalCode }];
  if (battery.capacityMah) additionalProperty.push({ '@type': 'PropertyValue', name: 'Capacity', value: battery.capacityMah, unitText: 'mAh' });
  if (battery.nominalVoltageMv) additionalProperty.push({ '@type': 'PropertyValue', name: 'Nominal voltage', value: battery.nominalVoltageMv / 1000, unitText: 'V' });
  const fits = battery.devices.map((d) => ({ '@type': 'Product', name: d.label, ...(d.modelNumber ? { model: d.modelNumber } : {}) }));
  return {
    ...(hasOwnMpn ? {} : { mpn: battery.canonicalCode }),
    additionalProperty,
    ...(fits.length === 0 ? {} : { isAccessoryOrSparePartFor: fits.length === 1 ? fits[0] : fits }),
  };
}

/**
 * ItemList of the batteries on the page, each a Product with the offer the
 * page shows. Facts only: the code as mpn, capacity only when recorded, the
 * phone as `isAccessoryOrSparePartFor` so an engine reads "spare part for
 * <phone>" rather than inferring it from prose. No rating, no gtin, no
 * invented fields.
 */
export function phonePageItemListJsonLd(
  device: Pick<FinderDeviceDto, 'label' | 'modelNumber'>,
  results: ReadonlyArray<Pick<FinderBatteryResultDto, 'slug' | 'name' | 'canonicalCode' | 'imageUrl' | 'priceUgx' | 'inStock' | 'capacityMah'>>,
): Record<string, unknown> {
  const abs = (u: string) => (/^https?:\/\//i.test(u) ? u : `${SITE_ORIGIN}${u}`);
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Replacement batteries for the ${device.label}`,
    numberOfItems: results.length,
    itemListElement: results.map((r, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Product',
        name: r.name,
        url: `${SITE_ORIGIN}/products/${r.slug}`,
        mpn: r.canonicalCode,
        brand: { '@type': 'Brand', name: 'GoldPlus' },
        isAccessoryOrSparePartFor: { '@type': 'Product', name: device.label, ...(device.modelNumber ? { model: device.modelNumber } : {}) },
        ...(r.imageUrl ? { image: abs(r.imageUrl) } : {}),
        ...(r.capacityMah ? { additionalProperty: [{ '@type': 'PropertyValue', name: 'Capacity', value: r.capacityMah, unitText: 'mAh' }] } : {}),
        ...(typeof r.priceUgx === 'number' && r.priceUgx > 0
          ? {
              offers: {
                '@type': 'Offer',
                priceCurrency: 'UGX',
                price: r.priceUgx,
                url: `${SITE_ORIGIN}/products/${r.slug}`,
                itemCondition: 'https://schema.org/NewCondition',
                availability: r.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
              },
            }
          : {}),
      },
    })),
  };
}
