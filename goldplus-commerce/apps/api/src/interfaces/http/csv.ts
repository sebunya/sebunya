import { csvSafeCell } from '../../domain/pricing/CsvSafe';

/**
 * The ONE CSV cell writer for HTTP exports.
 *
 * Three admin exports (loyalty draw, PIM error report, delivery corridors) each
 * carried their own quoting helper, and none neutralised a cell that begins
 * with =, +, -, @ or a control character: a spreadsheet executes such a cell as
 * a formula when the file is opened. The domain already had the correct helper
 * for coupon exports; every export now goes through it.
 */
export function csvCell(value: unknown): string {
  // A Date is written as ISO 8601: String(date) gave "Sat Nov 01 2026 03:00:00 GMT+0300 (East Africa Time)", which
  // finance tools cannot read (2026-11 review). An invalid Date is an empty cell.
  if (value instanceof Date) return csvSafeCell(Number.isNaN(value.getTime()) ? null : value.toISOString());
  return csvSafeCell(value == null ? null : typeof value === 'number' ? value : String(value));
}

/** A calendar-date column (postgres `date`, read as midnight UTC) as YYYY-MM-DD. */
export function csvDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return csvSafeCell(value.toISOString().slice(0, 10));
  return csvCell(value);
}
