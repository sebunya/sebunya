/**
 * Cut text to at most `max` characters (the ellipsis included), at the last
 * space before the limit. With no space before the limit (a run of SKU codes),
 * cut hard at the limit instead: lastIndexOf returned -1 and slice(0, -1) kept
 * almost the whole string.
 */
export function clipText(s: string, max: number): string {
  if (s.length <= max) return s;
  const space = s.lastIndexOf(' ', max - 1);
  const cut = space > 0 ? s.slice(0, space) : s.slice(0, max - 1);
  return `${cut.replace(/[,;:.\s]+$/, '')}…`;
}
