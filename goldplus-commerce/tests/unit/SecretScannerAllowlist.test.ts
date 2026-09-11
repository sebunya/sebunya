import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The secret scanner is only a control if it is BOTH green on a clean tree and
 * red on a real secret. Two deliberate test fixtures had it permanently red,
 * and a gate that always fails is a gate people stop reading.
 *
 * These run the real scanner against a throwaway git repo, so nothing is
 * written into this working tree (an untracked file here would also trip the
 * Slice 9 dirty-tree scope guards).
 */
const SCANNER = resolve(__dirname, '../../scripts/security/scan-secrets.mjs');
let repo: string;

/** Assembled at runtime so this file never itself contains a scannable secret. */
const FAKE_AWS_KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const MARKER = ['secret-scan', 'allow'].join(': ');

const run = (): { ok: boolean; out: string } => {
  try {
    const out = execFileSync('node', [SCANNER], { cwd: repo, encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

const write = (rel: string, body: string) => {
  mkdirSync(join(repo, rel, '..'), { recursive: true });
  writeFileSync(join(repo, rel), body);
};

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'gp-secret-scan-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe('secret scanner — the allowlist must not disarm the gate', () => {
  it('passes on a tree with no secrets', () => {
    write('apps/api/clean.ts', 'export const x = 1;\n');
    expect(run().ok).toBe(true);
  });

  it('FAILS on a realistic injected secret', () => {
    write('apps/api/leak.ts', `export const k = '${FAKE_AWS_KEY}';\n`);
    const r = run();
    expect(r.ok).toBe(false);
    expect(r.out).toContain('aws-access-key');
    rmSync(join(repo, 'apps/api/leak.ts'));
  });

  it('the marker exempts ONLY the line it is on', () => {
    // Marked line tolerated; the unmarked line below it must still be caught.
    write('apps/api/mixed.ts', [
      `export const fixture = '${FAKE_AWS_KEY}'; // ${MARKER} — test fixture`,
      `export const real = '${FAKE_AWS_KEY}';`,
      '',
    ].join('\n'));
    const r = run();
    expect(r.ok).toBe(false);
    // Exactly one finding, and it is line 2 — not the marked line 1.
    expect(r.out).toContain('apps/api/mixed.ts:2');
    expect(r.out).not.toContain('apps/api/mixed.ts:1');
    rmSync(join(repo, 'apps/api/mixed.ts'));
  });

  it('a fully marked file passes, so known fixtures can be tolerated deliberately', () => {
    write('apps/api/fixtures.ts', `export const f = '${FAKE_AWS_KEY}'; // ${MARKER} — fixture\n`);
    expect(run().ok).toBe(true);
  });
});

describe('the real repository', () => {
  it('is green, and the two SEO fixtures are marked rather than pattern-suppressed', () => {
    const root = resolve(__dirname, '../..');
    const out = execFileSync('node', [SCANNER], { cwd: root, encoding: 'utf8' });
    expect(out).toContain('Secret scan passed');
  });
});
