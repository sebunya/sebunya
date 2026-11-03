import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Review 2026-11-02 (#240): the admin gate let any cookie holder render /admin
// whenever the API answered 429/5xx or not at all. It must fail closed.
const src = readFileSync(resolve(__dirname, '../../apps/web/src/middleware.ts'), 'utf8');
const gate = src.slice(src.indexOf('async function holderIsAdmin'), src.indexOf('\n}\n', src.indexOf('async function holderIsAdmin')));

describe('admin console gate', () => {
  it('only a 200 opens the console; no branch returns yes on strain or error', () => {
    expect(gate.match(/return 'yes'/g)?.length).toBe(1);
    expect(gate).toMatch(/if \(res\.ok\) return 'yes'/);
    expect(gate).not.toMatch(/return true/);
    expect(gate).toMatch(/catch \{\s*return 'unknown';/);
  });

  it('an unknown verdict answers 503 and never serves the console or sets gp_staff', () => {
    const call = src.slice(src.indexOf("const verdict = await holderIsAdmin"), src.indexOf("gp_staff', '1'"));
    expect(call).toMatch(/verdict === 'unknown'[\s\S]*status: 503/);
    expect(call).toMatch(/verdict === 'no'[\s\S]*admin\/login/);
  });
});
