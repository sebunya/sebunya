/**
 * Listing copy that states more than the shop's own records support (brief WP3, 2026-11-05):
 *
 * 1. Flash drives: "works in any USB port" sat beside the spec "USB 3.0 (USB-A plug)". A USB-A plug does
 *    not go into a USB-C-only laptop or phone, so the copy now names the connector the spec records.
 * 2. GP-P05W (brief A2): the copy said the bank "snaps onto ... a phone with a magnetic ring" and "charges it
 *    wirelessly", which reads as if a magnetic ring or case makes any phone wirelessly chargeable. The phone itself
 *    must support wireless charging; the magnets only hold the bank in place. The wired rating (22.5W) and the
 *    wireless rating (15W) stay separate, and the built-in cables are named by connector, not "any other phone".
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
  [
    /10000mAh power bank that snaps onto the back of a phone with a magnetic ring and charges it wirelessly at up to 15W\./g,
    '10000mAh power bank with magnets that hold it on the back of a phone. Wireless charging up to 15W works only if the phone supports wireless charging.',
  ],
  [
    /No cable, no holding it in place\. The GP-P05W snaps magnetically onto the back of a phone that has a magnetic ring or a magnetic case and charges it wirelessly at up to 15W while you keep using the phone\. For any other phone, a Type-C cable and a Lightning cable are built into the back, with wired charging up to 22\.5W\./g,
    'The GP-P05W charges a phone wirelessly at up to 15W, but only if the phone itself supports wireless charging. The magnets just hold it in place on a phone with built-in magnets, a magnetic case or a magnetic ring; a magnetic case or ring does not make a phone wirelessly chargeable. For a phone with a Type-C or Lightning port, a Type-C cable and a Lightning cable are built into the back, with wired charging up to 22.5W.',
  ],
];

export function rewordListingFacts(text: string): string {
  let out = text;
  for (const [re, to] of LISTING_FACT_RULES) out = out.replace(re, to);
  return out;
}

/** Any phrasing the rules target, for the leftover warning. */
export const LISTING_FACT_CLAIM = /any USB port|magnetic ring and charges it wirelessly|magnetic case and charges it wirelessly|For any other phone, a Type-C cable/i;
