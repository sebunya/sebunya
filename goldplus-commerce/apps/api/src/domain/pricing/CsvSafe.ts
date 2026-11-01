/**
 * CSV export safety (U1 admin surface). Pure domain.
 *
 * Spreadsheet-formula injection: a cell beginning with = + - @ or a control
 * character is executed as a formula when the CSV is opened in Excel/Sheets, so
 * an attacker-controlled value could exfiltrate data or run a command. We
 * neutralise every risky cell by prefixing a single quote, and always quote and
 * escape the value. Applied to EVERY cell, defensively.
 */

// A cell is dangerous if it begins with a formula trigger or a control character
// (tab / CR / LF) that a reader may treat as the start of a formula or a new row.
const RISKY_LEADING = /^[=+\-@\t\r\n]/;

export function csvSafeCell(value: string | number | null | undefined): string {
  let text = value == null ? '' : String(value);
  if (RISKY_LEADING.test(text)) text = `'${text}`;
  // Standard CSV quoting: wrap in quotes and double any embedded quote.
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map((row) => row.map(csvSafeCell).join(',')).join('\r\n');
}

/** Coupon batch export: a header plus one row per code. */
export function couponBatchToCsv(codes: string[]): string {
  return toCsv([['code'], ...codes.map((code) => [code])]);
}
