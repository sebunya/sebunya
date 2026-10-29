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

/** "Replacement battery", not "battery replacement": the shop sells the battery and does not fit it (the page says so). */
export function phonePageTitle(device: Pick<FinderDeviceDto, 'label'>): string {
  return `${device.label} replacement battery, price in Kampala | GoldPlus`;
}

export type FitProvenance = 'checked' | 'listed' | 'mixed' | 'conditional';
const CHECKED = new Set(['VERIFIED_IN_STOCK', 'VERIFIED_OUT_OF_STOCK']);

/**
 * Where this page's fits come from, as one word, so the description and the page body cannot disagree. "Checked"
 * only when every fit was checked by the shop; a mix says so (each battery carries its own label).
 */
export function fitProvenance(results: ReadonlyArray<Pick<FinderBatteryResultDto, 'fitState'>>): FitProvenance {
  const states = results.map((r) => r.fitState);
  if (states.every((x) => x === 'AWAITING_VERIFICATION')) return 'listed';
  if (states.every((x) => CHECKED.has(x))) return 'checked';
  if (states.every((x) => x === 'CONDITIONAL')) return 'conditional';
  return 'mixed';
}

export const PROVENANCE_WORDS: Record<FitProvenance, string> = {
  checked: 'checked for this phone',
  listed: 'listed by our supplier for this phone',
  conditional: 'fits this phone with a condition (read it before you order)',
  mixed: 'checked by us or listed by our supplier (each battery says which)',
};

export function phonePageH1(device: Pick<FinderDeviceDto, 'label'>): string {
  return `Replacement battery for the ${device.label}`;
}

const ugx = (n: number): string => `UGX ${n.toLocaleString('en-UG')}`;

/** One honest sentence: how many, the code(s), the price, and where the fit comes from. */
export function phonePageDescription(
  device: Pick<FinderDeviceDto, 'label' | 'verifiedFits'>,
  results: ReadonlyArray<Pick<FinderBatteryResultDto, 'canonicalCode' | 'priceUgx' | 'fitState' | 'inStock'>>,
): string {
  if (results.length === 0) {
    return `We have not matched a battery to the ${device.label} yet. Tell us the model number, or send a photo of the old battery's label, and we check it.`;
  }
  const codes = [...new Set(results.map((r) => r.canonicalCode))].slice(0, 3).join(', ');
  const prices = results.map((r) => r.priceUgx).filter((p): p is number => typeof p === 'number' && p > 0);
  const price = prices.length ? ` from ${ugx(Math.min(...prices))}` : '';
  const provenance = PROVENANCE_WORDS[fitProvenance(results)];
  // "Dispatch", never "arrives": the day's run is a condition the page body states (docs/growth/README.md §5). And
  // only when something is in stock: an out-of-stock page promised a same-day run it could not make.
  const buy = results.some((r) => r.inStock)
    ? 'Order online for same-day dispatch in Kampala and Wakiso, or collect at the shop.'
    : 'Out of stock right now: ask us when it is back.';
  return `Replacement battery for the ${device.label}: pack code ${codes}${price}, ${provenance}. ${buy}`;
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
 * The batteries on the page as Google's summary list (ItemList of ListItem: position, url, name). The product facts,
 * the offer and the spare-part relation live on each product's own page (ProductJsonLd): Google reads product
 * snippets from a page about one product, and a list of full Products here duplicated them with fewer facts (an
 * unpriced one was an invalid Product with no offer). 2026-10-29 review.
 */
export function phonePageItemListJsonLd(
  device: Pick<FinderDeviceDto, 'label'>,
  results: ReadonlyArray<Pick<FinderBatteryResultDto, 'slug' | 'name'>>,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Replacement batteries for the ${device.label}`,
    numberOfItems: results.length,
    itemListElement: results.map((r, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE_ORIGIN}/products/${r.slug}`, name: r.name })),
  };
}

/**
 * A battery's product properties merged with the product's own verified ones: the live fit relation replaces the
 * free-text "Fits" attribute (they drift apart when a fit is added or rejected), and the pack code is not stated a
 * second time when a verified attribute already holds that value ("Battery model").
 */
export function mergeBatteryProperties(existing: ReadonlyArray<Record<string, unknown>>, battery: ReadonlyArray<Record<string, unknown>>): Array<Record<string, unknown>> {
  const kept = existing.filter((p) => String(p.name ?? '').toLowerCase() !== 'fits');
  const values = new Set(kept.map((p) => String(p.value ?? '').toUpperCase()));
  return [...kept, ...battery.filter((p) => !(p.name === 'Battery pack code' && values.has(String(p.value ?? '').toUpperCase())))];
}
