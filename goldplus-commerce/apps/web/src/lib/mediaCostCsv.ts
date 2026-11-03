/**
 * Parsing for the media-cost paste box:
 * `date,channel,platform,account,campaign,spend[,tax,currency,adSet,ad]`.
 *
 * Real CSV: a field in double quotes may hold commas, and "" inside quotes is a
 * literal quote. Anything the parser cannot read unambiguously is a row error,
 * never a guess:
 *  - an unterminated quote, or text after a closing quote;
 *  - more than 10 fields;
 *  - an unquoted field that starts with a space after a comma ("Promo, 2026"):
 *    exports never write that, so it is almost certainly a name with a comma
 *    in it that would shift every later column (spend ← "2026").
 */
export const MEDIA_COST_MAX_ROWS = 5_000;
export const MEDIA_COST_MAX_FIELDS = 10;

export type CsvLine = { ok: true; fields: string[] } | { ok: false; error: string };

export function parseCsvLine(line: string): CsvLine {
  const fields: string[] = [];
  let i = 0;
  for (;;) {
    if (line[i] === '"') {
      let value = '';
      i++;
      for (;;) {
        if (i >= line.length) return { ok: false, error: 'A quoted field is never closed (a " is missing).' };
        if (line[i] === '"') {
          if (line[i + 1] === '"') { value += '"'; i += 2; continue; }
          i++;
          break;
        }
        value += line[i++];
      }
      while (line[i] === ' ' || line[i] === '\t') i++;
      if (i < line.length && line[i] !== ',') return { ok: false, error: 'Text follows a closing quote. Quote the whole field.' };
      fields.push(value);
    } else {
      const end = line.indexOf(',', i);
      const raw = end === -1 ? line.slice(i) : line.slice(i, end);
      if (fields.length > 0 && /^\s+\S/.test(raw)) {
        return { ok: false, error: `Field ${fields.length + 1} starts with a space after a comma ("${raw.trim().slice(0, 30)}"): a name probably contains a comma. Put that name in double quotes; nothing is guessed.` };
      }
      fields.push(raw.trim());
      i = end === -1 ? line.length : end;
    }
    if (i >= line.length) break;
    i++; // the comma
  }
  if (fields.length > MEDIA_COST_MAX_FIELDS) {
    return { ok: false, error: `This line has ${fields.length} fields but the format allows at most ${MEDIA_COST_MAX_FIELDS}. A name with a comma must be in double quotes; nothing is guessed.` };
  }
  return { ok: true, fields };
}

/** Non-empty lines of the paste box, or an error when there are more than the cap (nothing is silently dropped). */
export function mediaCostLines(text: string): { ok: true; lines: string[] } | { ok: false; error: string } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length > MEDIA_COST_MAX_ROWS) {
    return { ok: false, error: `${lines.length.toLocaleString('en-GB')} rows pasted; the limit is ${MEDIA_COST_MAX_ROWS.toLocaleString('en-GB')} per batch. Split the file and submit each part. Nothing was checked or written.` };
  }
  return { ok: true, lines };
}
