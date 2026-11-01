/**
 * Is a Bank of Uganda dollar reading believable? One rule for both writers (the AllRatesToday feed in ControlFeeds and
 * the browser path's RecordBouFxReadingUseCase). Under the rate rule (the HIGHER of the market quote and BoU selling
 * plus the margin) one bad high value wins for up to five days, so a reading is refused unless every side is a
 * plausible rate and the sides sit in order: buying ≤ mid ≤ selling, and selling within 3% of mid (BoU's own spread is
 * about 0.1%). 2026-10-29 review: {mid 4303.81, selling 43088.1} passed the old checks.
 */
export const BOU_MIN_UGX = 1000;
export const BOU_MAX_UGX = 20000;
export const BOU_MAX_SELL_SPREAD = 0.03;

export function bouReadingProblem(r: { mid: number | null; buying: number | null; selling: number | null }): string | null {
  const plausible = (v: number | null) => v === null || (Number.isFinite(v) && v >= BOU_MIN_UGX && v <= BOU_MAX_UGX);
  if (!plausible(r.mid) || !plausible(r.buying) || !plausible(r.selling)) return `a rate outside ${BOU_MIN_UGX}–${BOU_MAX_UGX} shillings per dollar`;
  if (r.mid === null && r.selling === null) return 'neither a selling nor a mid rate';
  if (r.buying !== null && r.selling !== null && r.buying > r.selling) return 'buying above selling';
  if (r.mid !== null) {
    if (r.buying !== null && r.buying > r.mid + 1) return 'buying above mid';
    if (r.selling !== null && r.selling < r.mid - 1) return 'selling below mid';
    if (r.selling !== null && (r.selling - r.mid) / r.mid > BOU_MAX_SELL_SPREAD) return `selling more than ${BOU_MAX_SELL_SPREAD * 100}% above mid`;
  }
  return null;
}
