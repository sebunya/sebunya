/**
 * The "tested before sale" claim the shop stopped making (owner decision 2026-10-13). Pure, so the
 * rules are unit-tested; scripts/strip-tested-claim.ts applies them to the live descriptions.
 *
 * The battery fit variant ("Tested before sale; fit confirmed before you pay.") becomes the offer
 * "Not sure it fits? Ask us and we confirm it before you order." — never the bare fit promise, which the
 * 2026-10-29 review (a7461360, domain/batteries/BatteryFitWording) also removed.
 */

/** Ordered: longer phrasings first so the short catch-alls only see what is left. */
export const TESTED_CLAIM_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/ Every unit is tested before it is sold, with same-day delivery in Kampala and Wakiso\./g, ' Same-day delivery in Kampala and Wakiso.'],
  [/ Every unit is tested before it is sold; same-day delivery in Kampala and Wakiso\./g, ' Same-day delivery in Kampala and Wakiso.'],
  [/ Every unit (?:is )?tested before it is sold\.? Same-day delivery/g, ' Same-day delivery'],
  [/ Tested before sale; fit confirmed before you pay\./g, ' Not sure it fits? Ask us and we confirm it before you order.'],
  [/ Tested before sale\. Same-day/g, ' Same-day'],
  [/ Tested before sale\.?$/g, ''],
  [/ Every unit (?:is )?tested before it is sold\.?/g, ''],
  [/ Tested before sale\.?/g, ''],
];

export function stripClaim(text: string): string {
  let out = text;
  for (const [re, to] of TESTED_CLAIM_RULES) out = out.replace(re, to);
  return out.replace(/\s{2,}/g, ' ').trim();
}

/** Any wording of the claim, known to the rules or not. */
export const TESTED_CLAIM = /tested before|unit is tested/i;
