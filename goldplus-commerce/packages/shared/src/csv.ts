/**
 * One CSV grammar for every file the shop reads or writes (RFC 4180: quoted
 * fields, doubled quotes, CRLF). Six importers each carried their own split-
 * on-comma reader and the Control Centre's export quoted every cell while its
 * dry run split on bare commas, so the shop's own export could not be read
 * back (review board, 2026-10-15). A header row names the columns; lines
 * beginning with `#` are comments (data files carry their provenance there).
 */
export function parseCsv(content: string): Array<Record<string, string>> {
  const rows = parseCsvRows(content);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** The raw rows, comment lines and blank lines removed, quotes resolved. */
export function parseCsvRows(content: string): string[][] {
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
    if (atLineStart && ch === '#' && row.length === 0 && field === '') {
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
  // A cell that came out of the export with the formula guard (a leading apostrophe) loses it on the way back.
  return rows.map((r) => r.map((c) => (c.startsWith("'") && /^'[-+=@]/.test(c) ? c.slice(1) : c)));
}

/** A cell for a CSV we write: quoted when it needs to be, so it reads back through parseCsv. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
