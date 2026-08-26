import * as XLSX from 'xlsx';
import type { ParsedSheet, SpreadsheetParser } from '../../application/use-cases/batteries/BatteryImportUseCases';

/**
 * Reads .xlsx and .csv uploads into string rows. Formulas are never evaluated
 * (SheetJS only reads cached values, and `cellFormula: false` drops the formula
 * text); VBA is never parsed (`bookVBA` is off); every value is coerced to text
 * so nothing executable survives into the database.
 */
export class XlsxSpreadsheetParser implements SpreadsheetParser {
  parse(buffer: Buffer, filename: string, sheetName: string | null): ParsedSheet {
    const isCsv = filename.toLowerCase().endsWith('.csv');
    const workbook = isCsv
      ? XLSX.read(buffer.toString('utf8'), { type: 'string', raw: true, cellFormula: false, cellHTML: false, cellNF: false, cellText: false, bookVBA: false })
      : XLSX.read(buffer, { type: 'buffer', cellFormula: false, cellHTML: false, cellNF: false, cellText: false, bookVBA: false, bookDeps: false, bookFiles: false, bookProps: false });
    const sheetNames = workbook.SheetNames;
    const chosen = sheetName && sheetNames.includes(sheetName) ? sheetName : sheetNames[0];
    if (!chosen) return { sheetName: '', columns: [], rows: [], sheetNames };
    const sheet = workbook.Sheets[chosen];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true, blankrows: false }) as unknown[][];
    // The header is the first row whose cells are mostly distinct short strings;
    // audit-style sheets carry a title banner above the real header.
    let headerIndex = 0;
    for (let i = 0; i < Math.min(grid.length, 10); i++) {
      const cells = (grid[i] ?? []).map((c) => text(c)).filter(Boolean);
      const distinct = new Set(cells);
      if (cells.length >= 2 && distinct.size === cells.length && cells.every((c) => c.length <= 60)) { headerIndex = i; break; }
    }
    const rawHeader = (grid[headerIndex] ?? []).map((c) => text(c));
    const columns: string[] = [];
    const seen = new Map<string, number>();
    rawHeader.forEach((h, i) => {
      const base = (h || `Column ${i + 1}`).slice(0, 120);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      columns.push(n ? `${base} (${n + 1})` : base);
    });
    const rows: Record<string, string>[] = [];
    for (const line of grid.slice(headerIndex + 1)) {
      const row: Record<string, string> = {};
      let any = false;
      columns.forEach((col, i) => {
        const v = text(line[i]);
        row[col] = v;
        if (v) any = true;
      });
      if (any) rows.push(row);
    }
    return { sheetName: chosen, columns, rows, sheetNames };
  }
}

function text(cell: unknown): string {
  if (cell == null) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  if (typeof cell === 'number') return Number.isInteger(cell) ? String(cell) : String(Math.round(cell * 10000) / 10000);
  if (typeof cell === 'boolean') return cell ? 'true' : 'false';
  // Strip control characters; a leading formula trigger is kept as data (it is never evaluated).
  return String(cell).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
}
