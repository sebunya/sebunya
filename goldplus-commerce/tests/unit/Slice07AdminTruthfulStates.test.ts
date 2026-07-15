import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const adminRoot = resolve(root, 'apps/web/src/pages/admin');

const discover = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? discover(path) : [path];
  }).filter((p) => p.endsWith('.astro'));

const pages = discover(adminRoot);

describe('Slice 7 admin truthful-state contract', () => {
  it('no admin page renders fabricated SAMPLE data as records', () => {
    for (const page of pages) {
      const source = readFileSync(page, 'utf8');
      // Type-only imports (SampleQuote etc.) are fine; SAMPLE_ value constants are not.
      expect(source, `${relative(root, page)} must not use SAMPLE_ fallback data`).not.toMatch(/\bSAMPLE_[A-Z_]+\b/);
    }
  });

  it('no admin page promises sample data in its unavailability copy', () => {
    for (const page of pages) {
      const source = readFileSync(page, 'utf8');
      expect(source, `${relative(root, page)} must not claim sample data is shown`).not.toMatch(/[Ss]ample [a-z ]*shown until/);
    }
  });

  it('admin pages that fetch lists surface a truthful unavailable state', () => {
    for (const page of pages) {
      const source = readFileSync(page, 'utf8');
      if (source.includes('tryFetchAdminList')) {
        expect(source, `${relative(root, page)} must render the isSample/unavailable notice`).toContain('result.isSample');
      }
      if (source.includes('loadFailed')) {
        expect(source, `${relative(root, page)} must render its load-failure state`).toMatch(/loadFailed && /);
      }
    }
  });
});
