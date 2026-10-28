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
    return `We have not matched a battery to the ${device.label} yet. Tell us the model number and we check it; same-day delivery in Kampala and Wakiso once it is in stock.`;
  }
  const codes = [...new Set(results.map((r) => r.canonicalCode))].slice(0, 3).join(', ');
  const prices = results.map((r) => r.priceUgx).filter((p): p is number => typeof p === 'number' && p > 0);
  const price = prices.length ? ` from ${ugx(Math.min(...prices))}` : '';
  const provenance = results.every((r) => r.fitState === 'AWAITING_VERIFICATION')
    ? "listed by our supplier for this phone"
    : 'checked for this phone';
  return `Replacement battery for the ${device.label}: pack code ${codes}${price}, ${provenance}. Match the code, order online, same-day delivery in Kampala and Wakiso or collect at the shop.`;
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
