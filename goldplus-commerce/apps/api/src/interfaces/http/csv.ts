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
  return csvSafeCell(value == null ? null : typeof value === 'number' ? value : String(value));
}
