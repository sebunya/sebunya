import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Admin pages act as the signed-in admin, never as an invented one.
 *
 * The controlled-activation live-review pages identified the admin with a
 * hard-coded 'admin-123' in an `x-user-id` header and never sent the session
 * token. The API authenticates the Bearer token, so the list always read
 * "Failed to load" and no button could ever act. Separately, two admin pages
 * rendered invented data (release readiness gate results; the dry-run
 * orchestrator's REQ-12345 / PREVIEW_READY) with buttons that did nothing.
 */

const webSrc = path.resolve(__dirname, '../../apps/web/src');
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(astro|ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('no invented identity or data in the admin', () => {
  const files = walk(webSrc).map((f) => ({ f: path.relative(webSrc, f), src: fs.readFileSync(f, 'utf8') }));

  it('no page sends an x-user-id header or falls back to a made-up admin id', () => {
    const offenders = files.filter(({ src }) => /['"]x-user-id['"]\s*:/.test(src) || /\|\|\s*['"]admin-\d+['"]/.test(src)).map(({ f }) => f);
    expect(offenders).toEqual([]);
  });

  it('no admin page ships mock data or success alerts in place of a real call', () => {
    const offenders = files
      .filter(({ f }) => f.includes('admin'))
      .filter(({ src }) => /\/\/\s*Mock data/i.test(src) || /alert\(\s*['"`][^'"`]*(Built|Created|Generated|Starting|Canceling|Marked)/.test(src) || /REQ-12345|PREVIEW_READY/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')))
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });
});

describe('live-review API helper', () => {
  afterEach(() => vi.restoreAllMocks());

  it('calls with the admin session token and reads both error shapes', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ success: false, error: { code: 'LIVE_REVIEW_STATE_CONFLICT', message: 'Cannot run checks on a candidate in status: APPROVED' } }), { status: 409 });
    }));
    const { liveReviewAct } = await import('../../apps/web/src/lib/liveReviewApi');
    const r = await liveReviewAct('tok-1', 'cand/1', { kind: 'checks' });
    expect(r).toEqual({ ok: false, error: 'The live-review service answered 409. (Cannot run checks on a candidate in status: APPROVED)' });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-1');
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('x-user-id');
    expect(calls[0].url).toContain('/live-review-candidates/cand%2F1/checks');
    vi.unstubAllGlobals();
  });

  it('sends the approval body the API validates', async () => {
    let body = '';
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => { body = String(init.body); return new Response('{}', { status: 200 }); }));
    const { liveReviewAct } = await import('../../apps/web/src/lib/liveReviewApi');
    expect(await liveReviewAct('t', 'c', { kind: 'approval', status: 'APPROVED', note: 'ok' })).toEqual({ ok: true });
    expect(JSON.parse(body)).toEqual({ approvalStatus: 'APPROVED', approvalNote: 'ok' });
    vi.unstubAllGlobals();
  });
});
