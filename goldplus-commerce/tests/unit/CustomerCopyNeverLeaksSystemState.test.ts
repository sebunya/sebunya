import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Governance guard for the customer-language programme (2026-08-26).
 *
 * The defect class: the software describing itself to the customer instead of
 * helping them — HTTP numbers, "not configured", raw enums, demo modes,
 * provider text. Each pattern below was found on a live customer page during
 * the review. Admin pages are excluded: that vocabulary is correct there.
 */

const ROOT = join(__dirname, '../..');
const PAGES = join(ROOT, 'apps/web/src/pages');
const COMPONENTS = join(ROOT, 'apps/web/src/components');
const LIBS = join(ROOT, 'apps/web/src/lib');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (p.includes(`${PAGES}/admin`) || p.includes(`${COMPONENTS}/admin`)) continue;
      walk(p, out);
    } else if (/\.(astro|ts)$/.test(name) && !name.startsWith('admin')) {
      out.push(p);
    }
  }
  return out;
}

/** Strip comments so an explanation of a removed defect cannot trip the guard. */
const stripComments = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\(HTTP \$\{[^}]+\}\)/, why: 'an HTTP status number shown to a customer' },
  { pattern: /responded with HTTP/, why: 'an HTTP status number shown to a customer' },
  { pattern: /is not yet configured|is not configured\. It will activate|credentials are supplied/i, why: 'deployment state described to a customer' },
  { pattern: /local demonstration|Demo Mode|GP-DRAFT-/i, why: 'demo scaffolding on a customer path' },
  { pattern: /Error Reason:/, why: 'raw provider/exception text rendered to a customer' },
  { pattern: /status\.replace\(\/_\/g, ' '\)/, why: 'a raw status enum rendered to a customer' },
  { pattern: /Requires admin review/, why: 'an internal work instruction on a product page' },
  { pattern: /durably saved and audited|Customer DNA audience|audience state/, why: 'compliance/targeting vocabulary shown to a customer' },
  { pattern: /No funds have been charged/, why: 'an unconditional money claim on the payment return page' },
  { pattern: /your first order is reserved|Still reserved/, why: 'a first-order discount no pricing rule provides' },
];

describe('customer-facing code never describes the system to the customer', () => {
  const files = [...walk(PAGES), ...walk(COMPONENTS), ...walk(LIBS)];

  it('reads a substantial set of files, so the guard is not vacuous', () => {
    expect(files.length).toBeGreaterThan(80);
  });

  for (const { pattern, why } of FORBIDDEN) {
    it(`contains no "${pattern.source}" — ${why}`, () => {
      const offenders = files
        .filter((f) => pattern.test(stripComments(readFileSync(f, 'utf8'))))
        .map((f) => relative(ROOT, f));
      expect(offenders).toEqual([]);
    });
  }
});
