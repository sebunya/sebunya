/**
 * The loyalty programme's money settings form (/admin/loyalty → Programme
 * values). PUT /admin/loyalty/programme-config has PATCH semantics, so the form
 * sends ONLY the keys the operator changed — never a key it merely displayed.
 * Until 2026-09-24 no admin screen could set the point value, the redemption
 * limits, the budget cap or the kill switch at all.
 */
export const PROGRAMME_INTEGER_FIELDS: ReadonlyArray<{ key: string; label: string; hint?: string }> = [
  { key: 'pointValueUgx', label: 'Point value (UGX per point)', hint: 'The money a point is worth at redemption. The header money claim reads this.' },
  { key: 'redemptionMinPoints', label: 'Minimum points to redeem' },
  { key: 'redemptionMaxShareBps', label: 'Max share of an order payable in points (basis points, 10000 = 100%)' },
  { key: 'budgetCapPoints', label: 'Programme budget cap (points)' },
  { key: 'referralReferrerPoints', label: 'Referral — points to the referrer' },
  { key: 'referralRefereePoints', label: 'Referral — points to the new customer' },
  { key: 'birthdayPoints', label: 'Birthday points' },
  { key: 'streakTargetOrders', label: 'Streak — orders needed' },
  { key: 'streakWindowDays', label: 'Streak — window (days)' },
  { key: 'streakRewardPoints', label: 'Streak — reward points' },
  { key: 'guestBackfillLookbackDays', label: 'Guest backfill — look-back (days)' },
  { key: 'guestBackfillCapPoints', label: 'Guest backfill — cap (points)' },
];
export const PROGRAMME_BOOLEAN_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'killSwitch', label: 'Kill switch (stops earning and redemption)' },
  { key: 'chanceEnabled', label: 'Reward draws (chance) enabled' },
];

type FormLike = { get(name: string): FormDataEntryValue | null };

/** Only the changed keys. An emptied number is sent as null (clears it); an unchanged one is not sent at all. */
export function buildProgrammePatch(form: FormLike, original: Record<string, unknown>): Record<string, number | null | boolean | string> {
  const patch: Record<string, number | null | boolean | string> = {};
  for (const { key } of PROGRAMME_INTEGER_FIELDS) {
    const raw = form.get(key);
    if (raw === null) continue;
    const text = String(raw).replace(/[,\s]/g, '');
    // A non-number is passed through as text so the API refuses it by name,
    // never serialised as NaN → null (which would CLEAR the setting).
    const next = text === '' ? null : Number.isFinite(Number(text)) ? Number(text) : text;
    const before = original[key] === undefined ? null : (original[key] as number | null);
    if (next !== before) patch[key] = next;
  }
  for (const { key } of PROGRAMME_BOOLEAN_FIELDS) {
    const next = form.get(key) === 'on';
    if (next !== Boolean(original[key])) patch[key] = next;
  }
  return patch;
}
