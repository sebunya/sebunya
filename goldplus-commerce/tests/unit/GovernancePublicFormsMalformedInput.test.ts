import { describe, it, expect } from 'vitest';
import app from '../../apps/api/src/interfaces/http/app';

/**
 * The five public governance forms take raw JSON from anyone on the internet.
 * A malformed body is a caller error and must be a controlled 4xx — never a
 * 500. Two of these answered 500 in production on 2026-09-12: a numeric
 * `email` reached `.trim()`, and a missing `code` reached a SQL parameter.
 */
const junk = JSON.stringify({ x: null, items: 'nope', quantity: -1, email: 12345, phone: [], name: { a: 1 }, code: 42 });
const post = (path: string, body: string | null, contentType = 'application/json') =>
  app.request(path, { method: 'POST', headers: contentType ? { 'content-type': contentType } : {}, body: body ?? undefined });

describe('public governance forms — malformed input is a 4xx, not a 500', () => {
  const paths = ['/governance/verification/check', '/governance/quotes/request', '/governance/support/report-issue', '/governance/support/report-fake', '/governance/dealers/apply'];

  it('wrong-typed fields', async () => {
    for (const p of paths) {
      const res = await post(p, junk);
      expect(res.status, p).toBeGreaterThanOrEqual(400);
      expect(res.status, p).toBeLessThan(500);
    }
  });

  it('empty object', async () => {
    for (const p of paths) {
      const res = await post(p, '{}');
      expect(res.status, p).toBeGreaterThanOrEqual(400);
      expect(res.status, p).toBeLessThan(500);
    }
  });

  it('not JSON at all', async () => {
    for (const p of paths) {
      const res = await post(p, 'this is not json');
      expect(res.status, p).toBeGreaterThanOrEqual(400);
      expect(res.status, p).toBeLessThan(500);
    }
  });

  it('never leaks an exception message', async () => {
    for (const p of paths) {
      const text = await (await post(p, junk)).text();
      expect(text).not.toMatch(/trim is not a function|UNDEFINED_VALUE|at .*\.js:\d+/);
    }
  });
});
