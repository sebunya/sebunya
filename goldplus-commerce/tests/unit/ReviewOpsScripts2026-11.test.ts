import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseUsdRow } from '../../scripts/bou-fx.mjs';

const root = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('bou-fx: a blank rate cell is skipped, not 0', () => {
  it('blank or non-numeric cells leave the rate unknown', () => {
    const csv = [
      'x,U.S. Dollar/Uganda Shillings,Cross Rates,',
      'x,U.S. Dollar/Uganda Shillings,Buying,n/a',
      'x,U.S. Dollar/Uganda Shillings,Selling,""',
    ].join('\n');
    expect(parseUsdRow(csv)).toEqual({ mid: null, buying: null, selling: null });
  });
  it('real cells still parse, and the mid falls back to the mean', () => {
    const csv = [
      'x,U.S. Dollar/Uganda Shillings,Cross Rates,',
      'x,U.S. Dollar/Uganda Shillings,Buying,"3,700.10"',
      'x,U.S. Dollar/Uganda Shillings,Selling,"3,710.10"',
    ].join('\n');
    expect(parseUsdRow(csv)).toEqual({ mid: 3705.1, buying: 3700.1, selling: 3710.1 });
  });
});

describe('deploy-prod: no git diff | grep -q under pipefail', () => {
  const src = read('scripts/deploy-prod.sh');
  it('reads the changed files once and greps the variable', () => {
    expect(src).toContain('CHANGED_FILES="$(git diff --name-only --relative "$PREV" HEAD)"');
    expect(src).not.toMatch(/git diff --name-only[^\n]*\|\s*grep -q/);
    expect(src).not.toMatch(/caddy validate[^\n]*\|\s*grep -q/);
  });
});

describe('lighthouse-watch', () => {
  const src = read('scripts/lighthouse-watch.sh');
  it('stamps only after the run succeeded', () => {
    const stamp = src.indexOf('date +%s > "$STAMP"');
    expect(stamp).toBeGreaterThan(src.indexOf('docker run --rm'));
    expect(src.lastIndexOf('date +%s > "$STAMP"')).toBe(stamp);
  });
  it('a failed lighthouse run fails the unit', () => {
    expect(src).toContain('FAILED=$((FAILED+1))');
    expect(src).toContain('if [ "$FAILED" -gt 0 ]; then echo "STOP: $FAILED lighthouse run(s) failed"; exit 1; fi');
    expect(src).not.toContain('--quiet || echo "lighthouse failed');
  });
});

describe('Redis snapshot is not in the tree', () => {
  it('dump.rdb is gone and ignored', () => {
    expect(existsSync(join(root, 'dump.rdb'))).toBe(false);
    expect(read('.gitignore')).toMatch(/^dump\.rdb$/m);
  });
});
