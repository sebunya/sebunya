import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminFetchJson, photoUploadResult } from '../../apps/web/src/lib/adminFetch';
import { readNotice, redirectWithNotice } from '../../apps/web/src/lib/postRedirect';
import { MEDIA_COST_MAX_ROWS, mediaCostLines, parseCsvLine } from '../../apps/web/src/lib/mediaCostCsv';
import { mergeNewest } from '../../apps/web/src/lib/adminSeoIntegrations';

const web = (p: string) => readFileSync(resolve(__dirname, '../../apps/web/src', p), 'utf8');
const root = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── 220 ─────────────────────────────────────────────────────────────────────

describe('listing photo upload honours stored and the API message', () => {
  const answered = (json: unknown, status = 200) => ({ kind: 'answered' as const, status, json });
  it('nothing stored is an error with the API reason, never "Photos saved (0)"', () => {
    expect(photoUploadResult(answered({ success: true, stored: 0, message: 'All three were duplicates.' }), 3))
      .toEqual({ ok: false, message: 'All three were duplicates.' });
    expect(photoUploadResult(answered({ success: false, error: { message: 'Too large.' } }, 422), 1))
      .toEqual({ ok: false, message: 'Too large.' });
  });
  it('a partial upload carries the API note; a missing count is never filled in with files sent', () => {
    expect(photoUploadResult(answered({ success: true, stored: 2, message: 'One was blurry.' }), 3))
      .toEqual({ ok: true, stored: 2, note: 'One was blurry.' });
    expect(photoUploadResult(answered({ success: true }), 3).ok).toBe(false);
    expect(photoUploadResult(answered({ success: true, data: [{ outcome: 'ASSIGNED' }, { outcome: 'REJECTED' }] }), 2))
      .toEqual({ ok: true, stored: 1, note: null });
  });
  it('the listing page uses it', () => {
    const src = web('pages/admin/products/[id]/listing.astro');
    expect(src).toContain('photoUploadResult(outcome, files.length)');
    expect(src).not.toContain('json.stored ?? files.length');
  });
});

describe('admin fetches cannot throw a raw 500 or hang', () => {
  it('a network failure is "unreachable"; a timeout is applied', async () => {
    const failing = vi.fn(async () => { throw new TypeError('fetch failed'); });
    expect(await adminFetchJson('http://x', {}, 50, failing as never)).toEqual({ kind: 'unreachable' });
    const seen = vi.fn(async (_u: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ success: true }, { status: 201 });
    });
    expect(await adminFetchJson('http://x', {}, 50, seen as never)).toEqual({ kind: 'answered', status: 201, json: { success: true } });
  });
  it('the gallery, listing and import pages go through it', () => {
    for (const p of ['pages/admin/products/[id]/media.astro', 'pages/admin/products/[id]/listing.astro', 'pages/admin/media/imports/index.astro', 'pages/admin/media/imports/[id].astro']) {
      const src = web(p);
      expect(src, p).toContain('adminFetchJson(');
      expect(src, p).not.toMatch(/await fetch\(/);
    }
  });
});

describe('Post/Redirect/Get', () => {
  it('the notice rides the redirect and keeps the rest of the query', () => {
    const to = redirectWithNotice(new URL('https://x/admin/users?lookup=a%40b.c&notice=old'), { kind: 'success', text: 'Done.' }, '#existing-account');
    expect(to.startsWith('/admin/users?lookup=a%40b.c')).toBe(true);
    expect(to.endsWith('#existing-account')).toBe(true);
    expect(readNotice(new URL(`https://x${to.split('#')[0]}`))).toEqual({ kind: 'success', text: 'Done.' });
    expect(readNotice(new URL('https://x/?notice_kind=evil&notice=x'))).toBeNull();
  });
  it('platform-modules and users redirect after every POST; users keeps ?lookup=', () => {
    for (const p of ['pages/admin/platform-modules.astro', 'pages/admin/users/index.astro']) {
      expect(web(p), p).toContain('return Astro.redirect(');
      expect(web(p), p).toContain('redirectWithNotice(Astro.url');
      expect(web(p), p).toContain('readNotice(Astro.url)');
    }
    const users = web('pages/admin/users/index.astro');
    expect(users).not.toContain('<form method="POST" action="/admin/users#existing-account"');
    expect(users).toContain('action={`/admin/users?lookup=${encodeURIComponent(lookup.email)}#existing-account`}');
  });
});

describe('small admin truths', () => {
  it('recommendation stats show "—" when the rules fetch failed', () => {
    const src = web('pages/admin/recommendations/index.astro');
    expect(src).toContain('["Rules", isApiLive ? stats.total : "—"]');
  });
  it('aeo and content read typed times as Kampala time', () => {
    expect(web('pages/admin/seo/aeo.astro')).toContain('kampalaLocalToIso(observedAt)');
    expect(web('pages/admin/seo/content.astro')).toContain('kampalaLocalToIso(');
    expect(web('pages/admin/seo/aeo.astro')).not.toContain('new Date(observedAt)');
    expect(web('pages/admin/seo/content.astro')).not.toContain('new Date(when)');
  });
  it('aeo reports which engines were added when only some succeed', () => {
    expect(web('pages/admin/seo/aeo.astro')).toContain('NOT added for');
  });
  it('privacy requests reject an unknown action instead of declining', () => {
    const src = web('pages/admin/privacy-requests.astro');
    expect(src).toContain('action === "decline"');
    expect(src).toContain('Unknown action. Nothing was changed.');
  });
  it('rule targets come from the categories API and the admin product list', () => {
    const src = web('pages/admin/recommendations/rules/new.astro');
    expect(src).not.toContain('CATEGORY_SLUG');
    expect(src).not.toContain('/products?limit=100');
    expect(src).toContain('${apiBase}/admin/products`');
    expect(src).toContain('${apiBase}/admin/products/categories`');
  });
  it('archiving a rule still asks: the form carries data-confirm and the admin layout loads the handler', () => {
    expect(web('pages/admin/recommendations/rules/[id].astro')).toContain('<form method="POST" data-confirm="Archive this rule permanently?"');
    expect(web('layouts/AdminLayout.astro')).toContain('<DeclarativeActions />');
    expect(web('components/DeclarativeActions.astro')).toContain("form?.hasAttribute('data-confirm') && !confirmed(form)");
  });
});

describe('media-cost CSV', () => {
  it('reads quoted fields with commas and escaped quotes', () => {
    expect(parseCsvLine('2026-10-30,paid_social,meta,acct,"Promo, 2026",150000')).toEqual({
      ok: true, fields: ['2026-10-30', 'paid_social', 'meta', 'acct', 'Promo, 2026', '150000'],
    });
    expect(parseCsvLine('a,"say ""hi""",c')).toEqual({ ok: true, fields: ['a', 'say "hi"', 'c'] });
  });
  it('rejects the ambiguous unquoted comma that shifted spend', () => {
    const r = parseCsvLine('2026-10-30,paid_social,meta,acct,Promo, 2026,150000');
    expect(r.ok).toBe(false);
  });
  it('rejects unterminated quotes and more than 10 fields', () => {
    expect(parseCsvLine('a,"b,c').ok).toBe(false);
    expect(parseCsvLine('1,2,3,4,5,6,7,8,9,10,11').ok).toBe(false);
  });
  it('refuses more than 5,000 rows instead of slicing', () => {
    const many = Array.from({ length: MEDIA_COST_MAX_ROWS + 1 }, () => 'x').join('\n');
    expect(mediaCostLines(many).ok).toBe(false);
    expect(mediaCostLines('a\n\nb')).toEqual({ ok: true, lines: ['a', 'b'] });
    expect(web('pages/admin/media-costs.astro')).not.toContain('.slice(0, 5_000)');
  });
});

// ── 221 ─────────────────────────────────────────────────────────────────────

describe('system page', () => {
  it('a 401 is not "Online" for the API or admin authentication', () => {
    const src = web('pages/admin/system/index.astro');
    expect(src).toContain('const notPermitted = (status: number) => status === 403;');
    expect(src).toContain('sessionRejected = true;');
    expect(src).toContain("if (sessionRejected) {\n    auth.status = 'Offline';");
  });
});

describe('capped body reads', () => {
  const chunked = (bytes: number) => new Request('https://x/api', {
    method: 'POST',
    headers: { cookie: 'goldplus_session=x' },
    body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(bytes)); c.close(); } }),
    duplex: 'half',
  } as RequestInit);

  it('care/push refuses an oversized chunked body without calling the API', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const { POST } = await import('../../apps/web/src/pages/api/admin/care/push');
    const res = await POST({ request: chunked(5000) } as never);
    expect(res.status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
  });

  it('csp-report uses the shared reader and refuses an oversized chunked body', async () => {
    const { POST } = await import('../../apps/web/src/pages/api/csp-report');
    expect((await POST({ request: chunked(17 * 1024) } as never)).status).toBe(413);
    const src = web('pages/api/csp-report.ts');
    expect(src).toContain('readBodyCapped(request, MAX_BODY)');
    expect(src).not.toContain('async function readBounded');
  });
});

describe('social sign-in rotates and links gp_visit like password login', () => {
  it('sets a fresh visit token and links it to the customer', () => {
    const src = web('pages/auth/[provider]/callback.ts');
    expect(src).toContain('mintSignedVisitToken()');
    expect(src).toContain('${VISIT_COOKIE_NAME}=${rotatedVisit}');
    expect(src).toContain('/recommendations/profile/link');
    expect(src).toContain("'x-gp-visit': rotatedVisit");
  });
});

describe('SEO integrations', () => {
  it('every id in an API path is encoded', () => {
    for (const p of ['pages/admin/seo/integrations/[provider].astro', 'pages/admin/seo/integrations/sync.astro']) {
      const unencoded = web(p).split('\n').filter((l) => /INTEGRATIONS_API\}[^`?]*\$\{(?!encodeURIComponent\()/.test(l));
      expect(unencoded, p).toEqual([]);
    }
  });
  it('provider history is asked per connection, newest first, no duplicates', () => {
    const src = web('pages/admin/seo/integrations/[provider].astro');
    expect(src).toContain('/sync-jobs?connectionId=');
    expect(src).toContain('/audit?connectionId=');
    expect(src).not.toContain('/sync-jobs?limit=25`');
    const merged = mergeNewest(
      [[{ id: 'a', t: '2026-10-01' }, { id: 'b', t: '2026-10-03' }], [{ id: 'b', t: '2026-10-03' }, { id: 'c', t: '2026-10-02' }]],
      (r) => r.t,
      2,
    );
    expect(merged.map((r) => r.id)).toEqual(['b', 'c']);
  });
});

describe('customer sign-out', () => {
  it('revokes this session only; logout-all only for an explicit "everywhere"', () => {
    const src = web('pages/logout.ts');
    expect(src).toContain('${apiBase}/auth/logout`');
    expect(src).toContain('refreshToken: decodeURIComponent(refreshToken)');
    expect(src).toContain("url.searchParams.get('scope') === 'all'");
    expect(src).toMatch(/if \(everywhere && token\) \{\s+await fetch\(`\$\{apiBase\}\/auth\/logout-all`/);
  });
});

describe('scan-secrets and storage tests', () => {
  it('the scanner covers every *.example template', () => {
    const src = root('scripts/security/scan-secrets.mjs');
    expect(src).toContain("basename(file).endsWith('.example')");
  });
  it('a measured 0 MB/s is shown, not "—"', () => {
    const src = web('pages/admin/seo/storage-tests.astro');
    expect(src).not.toContain('t.read_mb_s ?');
    expect(src).toContain('{mbps(t.read_mb_s)}');
  });
});
