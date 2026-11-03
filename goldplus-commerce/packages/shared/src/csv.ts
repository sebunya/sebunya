/**
 * One CSV grammar for every file the shop reads or writes (RFC 4180: quoted
 * fields, doubled quotes, CRLF). Six importers each carried their own split-
 * on-comma reader and the Control Centre's export quoted every cell while its
 * dry run split on bare commas, so the shop's own export could not be read
 * back (review board, 2026-10-15). A header row names the columns.
 *
 * Two behaviours are OPT-IN, because on a file someone else wrote they lose data
 * silently:
 *  - `comments`: lines beginning with `#` are dropped. Only for the shop's own
 *    data files in the repo (data/geo carries provenance there). A supplier row
 *    such as "#12 Burton St,..." would otherwise vanish from an import.
 *  - `unguardFormulas`: a leading apostrophe before - + = @ is removed. Only for
 *    a file the shop itself exported with that formula guard; a supplier's
 *    "'-5" must stay as written.
 */
export interface CsvReadOptions {
  comments?: boolean;
  unguardFormulas?: boolean;
}

export function parseCsv(content: string, opts: CsvReadOptions = {}): Array<Record<string, string>> {
  const rows = parseCsvRows(content, opts);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** The raw rows, blank lines (and, when asked, comment lines) removed, quotes resolved. */
export function parseCsvRows(content: string, opts: CsvReadOptions = {}): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let atLineStart = true;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (quoted) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (opts.comments && atLineStart && ch === '#' && row.length === 0 && field === '') {
      while (i < content.length && content[i] !== '\n') i++;
      continue;
    }
    atLineStart = false;
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim().length > 0)) rows.push(row);
      row = [];
      atLineStart = true;
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim().length > 0)) rows.push(row);
  }
  // A cell that came out of OUR export with the formula guard (a leading apostrophe) loses it on the way back.
  if (!opts.unguardFormulas) return rows;
  return rows.map((r) => r.map((c) => (/^'[-+=@]/.test(c) ? c.slice(1) : c)));
}

/** A cell for a CSV we write: quoted when it needs to be, so it reads back through parseCsv. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
