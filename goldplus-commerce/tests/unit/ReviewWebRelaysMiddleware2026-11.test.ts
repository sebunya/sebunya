import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { relayHeaders } from '../../apps/web/src/lib/relayHeaders';
import { indexNowKey, resetIndexNowKeyCache } from '../../apps/web/src/lib/indexNowKey';

const web = (p: string) => readFileSync(join(__dirname, '../../apps/web/src', p), 'utf8');
const mw = web('middleware.ts');

describe('holderIsAdmin forwards the visitor address', () => {
  it('sends X-Forwarded-For from the client address', () => {
    expect(mw).toContain('async function holderIsAdmin(request: Request, clientAddress: string | null)');
    expect(mw).toContain('headers: apiHeaders({ Authorization: `Bearer ${bearer}` }, clientAddress)');
    expect(mw).toContain('holderIsAdmin(context.request, readClientAddress(context))');
  });
  it('answers unknown on 429/5xx/outage; the gate turns that into a 503 (fail closed, owner decision 2026-11-03 — see AdminGateFailsClosed.test.ts)', () => {
    expect(mw).toContain("if (res.status < 500 && res.status !== 429) return 'no';\n    return 'unknown';");
  });
});

describe('session renewal runs on document requests only', () => {
  it('is gated on isDocument, which is computed before it', () => {
    expect(mw).toContain('if (isDocument) await renewSessionIfDue(context);');
    expect(mw.indexOf('const isDocument =')).toBeLessThan(mw.indexOf('if (isDocument) await renewSessionIfDue(context);'));
    expect(mw).not.toContain("startsWith('/_astro/')) await renewSessionIfDue");
  });
});

describe('_fp_cid host-only duplicate', () => {
  it('expires the host-only cookie when the domain cookie is set', () => {
    expect(mw).toContain("export const HOST_ONLY_FP_CID_EXPIRY = '_fp_cid=; Path=/; Max-Age=0;");
    expect(mw).not.toMatch(/HOST_ONLY_FP_CID_EXPIRY = '[^']*Domain=/);
    expect(mw).toContain('if (fpDomain) dropHostOnlyFpCid = true;');
    expect(mw).toContain("response.headers.append('Set-Cookie', HOST_ONLY_FP_CID_EXPIRY)");
  });
});

describe('form relays use the address Astro saw, not the client XFF', () => {
  for (const f of ['pages/api/battery-request.ts', 'pages/api/bulk/quote.ts', 'pages/api/bulk/access/start.ts', 'pages/api/bulk/access/verify.ts', 'pages/api/saved.ts']) {
    it(f, () => {
      const src = web(f);
      expect(src).not.toContain("request.headers.get('x-forwarded-for')");
      expect(src).toMatch(/readClientAddress\((context|ctx)\)/);
      expect(src).toContain('apiHeaders(');
    });
  }
});

describe('404 page uses the shared recorded-redirect lookup', () => {
  it('calls findRecordedRedirect (which refuses self-loops) instead of its own copy', () => {
    const src = web('pages/404.astro');
    expect(src).toContain('await findRecordedRedirect(Astro.url.pathname)');
    expect(src).not.toContain('/seo/resolve-redirect');
  });
});

describe('telemetry relays', () => {
  const relays = ['pages/api/rec/[...path].ts', 'pages/api/hero/events.ts', 'pages/api/hero/signals.ts', 'pages/api/nav/events.ts'];
  it('no copied API_BASE / token shape, no destructured clientAddress', () => {
    for (const f of relays) {
      const src = web(f);
      expect(src, f).not.toContain('const API_BASE');
      expect(src, f).not.toContain('VISIT_TOKEN_SHAPE');
      expect(src, f).not.toContain('clientAddress');
      expect(src, f).toContain('relayHeaders(context,');
      expect(src, f).toContain('${apiBase}/');
    }
  });
  it('relayHeaders survives a throwing clientAddress getter and forwards only the verified visit', () => {
    const ctx = { locals: { gpVisit: 'signed-token' }, get clientAddress(): string { throw new Error('prerender'); } };
    expect(relayHeaders(ctx, { Accept: 'application/json' })).toEqual({ Accept: 'application/json', 'x-gp-visit': 'signed-token' });
    expect(relayHeaders({ locals: {}, clientAddress: '1.2.3.4' }, {})).toEqual({ 'X-Forwarded-For': '1.2.3.4' });
  });
});

describe('IndexNow key is cached', () => {
  beforeEach(() => resetIndexNowKeyCache());
  it('asks the API once per TTL', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return new Response(JSON.stringify({ success: true, data: { key: 'abcdef12' } })); };
    let t = 1_000;
    const now = () => t;
    expect(await indexNowKey({ fetchImpl, now })).toBe('abcdef12');
    expect(await indexNowKey({ fetchImpl, now })).toBe('abcdef12');
    expect(calls).toBe(1);
    t += 6 * 60 * 1000;
    await indexNowKey({ fetchImpl, now });
    expect(calls).toBe(2);
  });
  it('a failed read is cached briefly, then retried', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; throw new Error('down'); };
    let t = 0;
    const now = () => t;
    expect(await indexNowKey({ fetchImpl, now })).toBeNull();
    expect(await indexNowKey({ fetchImpl, now })).toBeNull();
    expect(calls).toBe(1);
    t += 31_000;
    await indexNowKey({ fetchImpl, now });
    expect(calls).toBe(2);
  });
});
