/**
 * Listing copy that states more than the shop's own records support (brief WP3, 2026-11-05):
 *
 * 1. Flash drives: "works in any USB port" sat beside the spec "USB 3.0 (USB-A plug)". A USB-A plug does
 *    not go into a USB-C-only laptop or phone, so the copy now names the connector the spec records.
 * Delivery wording is NOT reworded: owner decision 2026-11-05, the promise is same-day dispatch AND delivery in
 *    Kampala and Wakiso (orders before the cut-off), so "Same-day delivery in Kampala and Wakiso." stays.
 *
 * Pure, so the rules are unit-tested; scripts/apply-listing-fact-wording.ts applies them to the live
 * descriptions (dry run by default). The seed data files were edited in the same commit.
 */

export const LISTING_FACT_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/works in any USB port/g, 'plugs into a USB-A port'],
  [/Plugs into any USB port/g, 'Plugs into a USB-A port'],
  [/plug it into any USB port/g, 'plug it into a USB-A port'],
];

export function rewordListingFacts(text: string): string {
  let out = text;
  for (const [re, to] of LISTING_FACT_RULES) out = out.replace(re, to);
  return out;
}

/** Any phrasing the rules target, for the leftover warning. */
export const LISTING_FACT_CLAIM = /any USB port/i;
