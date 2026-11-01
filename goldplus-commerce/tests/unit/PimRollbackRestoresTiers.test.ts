import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(resolve(__dirname, '../../apps/api/src/infrastructure/db/repositories/DrizzlePimImportRepository.ts'), 'utf8');

/**
 * An import that overwrote the floor (Price A) and tiers B/C could only have
 * its retail price rolled back: the old retail could sit below the imported
 * floor (the CHECK refused it, silently) or the discount floor stayed lowered.
 */
describe('PIM rollback restores the price tiers the import overwrote', () => {
  it('snapshots carry the floor and tiers B/C', () => {
    expect(src).toMatch(/floorPriceUgx: tiers\?\.floorPrice \?\? null, tierBPriceUgx: tiers\?\.tierBPrice \?\? null, tierCPriceUgx: tiers\?\.tierCPrice \?\? null/);
    expect(src).toMatch(/catalogueSnapshot: snapshot\(row, priceByProduct\.get\(row\.id\)\?\.retailPrice \?\? null, priceByProduct\.get\(row\.id\) \?\? null\)/);
  });

  it('rollback puts price and tiers back in ONE update, only for keys the snapshot has', () => {
    const rollback = src.slice(src.indexOf('async rollback('), src.indexOf('async events('));
    expect(rollback).toMatch(/"floorPriceUgx" in before \? \{ floorPrice:/);
    expect(rollback).toMatch(/\.set\(\{ retailPrice: Number\(before\.retailPriceUgx\), \.\.\.tiersBack \}\)/);
  });

  it('a failed row records why, and the event names it', () => {
    const rollback = src.slice(src.indexOf('async rollback('), src.indexOf('async events('));
    expect(rollback).toMatch(/error: `Rollback failed: \$\{\(error as Error\)\.message\}`/);
    expect(rollback).toMatch(/failedRowIds,/);
    expect(rollback).not.toMatch(/\} catch \{\s+failed \+= 1;/);
  });
});
