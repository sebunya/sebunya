import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// hono lives in the API workspace; the root test run cannot resolve the bare name.
import { Hono } from '../../apps/api/node_modules/hono/dist/index.js';
import { bodyLimit } from '../../apps/api/node_modules/hono/dist/middleware/body-limit/index.js';
import { MfaService } from '../../apps/api/src/infrastructure/security/MfaService';
import { encryptSecret, totp, generateTotpSecret } from '../../apps/api/src/infrastructure/security/TotpService';
import { RegisterCustomerUseCase } from '../../apps/api/src/application/use-cases/identity/RegisterCustomerUseCase';
import {
  ResetPasswordWithSmsCodeUseCase,
  InMemoryMissedResetAttemptCounter,
  SMS_RESET_MAX_ATTEMPTS,
} from '../../apps/api/src/application/use-cases/identity/SmsPasswordResetUseCases';
import { toPublicRecommendationEventInput } from '../../apps/api/src/application/recommendations/RecommendationValidation';
import { withoutBrowserAuthority, exceedsBrowserValueCeiling } from '../../apps/api/src/application/use-cases/telemetry/BrowserTelemetryAuthority';
import { CollectBrowserBatchUseCase, type CollectorStore } from '../../apps/api/src/application/use-cases/telemetry/CollectBrowserBatchUseCase';
import { ListMeasurementDlqUseCase } from '../../apps/api/src/application/use-cases/measurement/ListMeasurementDlqUseCase';
import { CaptureZeroPartyDataUseCase } from '../../apps/api/src/application/use-cases/measurement/CaptureZeroPartyDataUseCase';
import { isMaintenanceExempt } from '../../apps/api/src/interfaces/http/middleware/maintenance';
import { activationRefusal } from '../../apps/api/src/interfaces/http/activationErrors';
import { buildMerchantFeedXml, feedAvailability, type FeedProduct } from '../../apps/api/src/application/use-cases/seo-growth/MerchantFeedUseCase';
import { readBodyCapped } from '../../apps/web/src/lib/boundedBody';
import { chargedPriceUgx, realProductImageUrls } from '../../apps/web/src/lib/productStructuredData';

const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

/**
 * Platform/security sweep, low-severity findings (2026-09-24). Each block pins
 * the behaviour that was wrong, so it cannot quietly come back.
 */

// ── MFA ─────────────────────────────────────────────────────────────────────

function mfaRepo(record: { confirmedAt: Date | null; failedAttempts?: number; updatedAt?: Date; secret: string }) {
  const state = {
    rec: {
      userId: 'u1',
      secretCiphertext: encryptSecret(record.secret),
      confirmedAt: record.confirmedAt,
      lastVerifiedAt: null as Date | null,
      failedAttempts: record.failedAttempts ?? 0,
      updatedAt: record.updatedAt ?? new Date(0),
    },
    replaced: 0,
    confirmed: 0,
  };
  const repo = {
    get: async () => ({ ...state.rec }),
    upsertEnrolment: async () => undefined,
    confirm: async (_u: string, at: Date) => { state.confirmed += 1; state.rec.confirmedAt = at; state.rec.lastVerifiedAt = at; state.rec.failedAttempts = 0; },
    recordVerification: async () => undefined,
    recordFailure: async (_u: string, at: Date) => { state.rec.failedAttempts += 1; state.rec.updatedAt = at; return state.rec.failedAttempts; },
    replaceRecoveryCodes: async () => { state.replaced += 1; },
    consumeRecoveryCode: async () => false,
    disable: async () => undefined,
  };
  return { repo, state };
}

describe('MFA confirmation cannot route around the step-up lock', () => {
  const now = new Date('2026-09-24T10:00:00Z');

  it('an already-confirmed enrolment is never re-confirmed: no step-up stamp, no new recovery codes', async () => {
    const secret = generateTotpSecret();
    const { repo, state } = mfaRepo({ confirmedAt: new Date('2026-09-01'), secret });
    const svc = new MfaService(repo as never);
    const result = await svc.confirmEnrolment('u1', totp(secret, now.getTime()), now);
    expect(result.ok).toBe(false);
    expect(state.confirmed).toBe(0);
    expect(state.replaced).toBe(0);
  });

  it('wrong codes count against the lock, and a locked enrolment refuses even the right code', async () => {
    const secret = generateTotpSecret();
    const { repo, state } = mfaRepo({ confirmedAt: null, secret });
    const svc = new MfaService(repo as never);
    for (let i = 0; i < MfaService.MAX_FAILURES; i += 1) {
      expect((await svc.confirmEnrolment('u1', '000000', now)).ok).toBe(false);
    }
    expect(state.rec.failedAttempts).toBe(MfaService.MAX_FAILURES);
    const locked = await svc.confirmEnrolment('u1', totp(secret, now.getTime()), now);
    expect(locked).toEqual({ ok: false, locked: true });
    expect(state.replaced).toBe(0);
  });

  it('first enrolment still works with the right code', async () => {
    const secret = generateTotpSecret();
    const { repo, state } = mfaRepo({ confirmedAt: null, secret });
    const result = await new MfaService(repo as never).confirmEnrolment('u1', totp(secret, now.getTime()), now);
    expect(result.ok).toBe(true);
    expect(result.recoveryCodes?.length).toBeGreaterThan(0);
    expect(state.replaced).toBe(1);
  });

  it('the confirm route answers a lock with 429 MFA_LOCKED', () => {
    const src = read('apps/api/src/interfaces/http/routes/auth.ts');
    const block = src.slice(src.indexOf("routes.post('/mfa/confirm'"), src.indexOf("routes.post('/mfa/verify'"));
    expect(block).toContain('result.locked');
    expect(block).toContain("'MFA_LOCKED'");
    expect(block).toContain('429');
  });
});

// ── Sign-in, sign-out ───────────────────────────────────────────────────────

describe('customer sign-in and sign-out', () => {
  it('sign-out revokes the token server-side (same-origin only) and replaces the linked visit cookie', () => {
    const src = read('apps/web/src/pages/logout.ts');
    expect(src).toContain('/auth/logout-all');
    expect(src).toContain('checkRequestOrigin(request');
    expect(src).toContain('${apiBase}');
    expect(src).not.toContain('PUBLIC_API_BASE_URL');
    expect(src).toContain('mintSignedVisitToken()');
    expect(src).toContain('cookies.set(VISIT_COOKIE_NAME');
    expect(src).toContain('clearSessionCookie()');
  });

  it('login and registration refuse a cross-site form post before calling the API', () => {
    for (const page of ['apps/web/src/pages/login.astro', 'apps/web/src/pages/register.astro']) {
      const src = read(page);
      const check = src.indexOf('checkRequestOrigin(Astro.request');
      expect(check, page).toBeGreaterThan(-1);
      const apiCall = src.indexOf(page.includes('login') ? '/auth/login' : '/auth/register');
      expect(check, page).toBeLessThan(apiCall);
      expect(src, page).toContain('CROSS_SITE_MESSAGE');
    }
  });
});

// ── One number, one account ─────────────────────────────────────────────────

describe('registration refuses a phone number already held in another shape', () => {
  function build(taken: string[]) {
    const created: unknown[] = [];
    const users = {
      findByEmail: async () => null,
      findById: async () => null,
      findByPhone: async () => null,
      phoneInUse: async (e164: string) => {
        const national = e164.slice(4);
        return taken.some((t) => [e164, `256${national}`, `0${national}`, national].includes(t));
      },
      create: async (i: { email: string; phone: string | null }) => { created.push(i); return { id: 'u9', email: i.email, phone: i.phone }; },
    };
    const uc = new RegisterCustomerUseCase(users as never, { hash: async (p: string) => `h:${p}`, verify: async () => true } as never, {
      isConfigured: () => true, sign: async () => 'tok', verify: async () => null,
    } as never);
    return { uc, created };
  }

  it.each(['256759113138', '+256759113138', '759113138', '0759113138'])('typed as %s while 0759113138 is taken → ALREADY_REGISTERED, nothing created', async (typed) => {
    const { uc, created } = build(['0759113138']);
    const r = await uc.execute({ email: 'new@example.com', phone: typed, password: 'longenough' });
    expect(r).toMatchObject({ ok: false, code: 'ALREADY_REGISTERED' });
    expect(created).toHaveLength(0);
  });

  it('a free number still registers', async () => {
    const { uc, created } = build(['0700000001']);
    expect((await uc.execute({ email: 'new@example.com', phone: '0759113138', password: 'longenough' })).ok).toBe(true);
    expect(created).toHaveLength(1);
  });
});

// ── SMS reset: no existence oracle in the attempt limit ─────────────────────

describe('the SMS reset attempt limit is the same for every number', () => {
  const sha = (v: string) => createHash('sha256').update(v).digest('hex');
  it('an unregistered number turns to TOO_MANY_ATTEMPTS on the same guess a registered one does', async () => {
    const reset = new ResetPasswordWithSmsCodeUseCase(
      { findByPhone: async () => null } as never,
      { latestOtp: async () => null, bumpOtpAttempts: async () => 0, consumeOtp: async () => undefined, markPhoneVerified: async () => undefined } as never,
      { setPasswordAndRevokeSessions: async () => true } as never,
      { hash: async () => 'x', verify: async () => true } as never,
      sha,
      () => new Date('2026-09-24T10:00:00Z'),
      new InMemoryMissedResetAttemptCounter(),
    );
    const codes: string[] = [];
    for (let i = 0; i < SMS_RESET_MAX_ATTEMPTS + 1; i += 1) {
      const r = await reset.execute({ phone: '0700000000', code: '123456', newPassword: 'longenough' });
      codes.push(r.ok ? 'OK' : r.code);
    }
    expect(codes.slice(0, SMS_RESET_MAX_ATTEMPTS).every((c) => c === 'CODE_INVALID')).toBe(true);
    expect(codes[SMS_RESET_MAX_ATTEMPTS]).toBe('TOO_MANY_ATTEMPTS');
  });

  it('the counter window expires and its memory is bounded', () => {
    const c = new InMemoryMissedResetAttemptCounter(1000, 2);
    const t = new Date(0);
    expect(c.bump('a', t)).toBe(1);
    expect(c.bump('a', t)).toBe(2);
    expect(c.bump('a', new Date(1500))).toBe(1);
    c.bump('b', t); c.bump('c', t); c.bump('d', t);
    expect(c.bump('d', t)).toBe(2);
  });
});

// ── Recommendation events: no forged purchases ──────────────────────────────

describe('the public recommendation event route', () => {
  it('refuses server-only event types such as PRODUCT_PURCHASED', () => {
    expect(() => toPublicRecommendationEventInput({ eventType: 'PRODUCT_PURCHASED', productId: 'p' })).toThrow();
  });

  it('keeps only browser fields: customerId only from the session, never dedupeKey or schemaVersion', () => {
    const out = toPublicRecommendationEventInput({
      eventType: 'PRODUCT_ADDED_TO_CART', productId: 'p1', anonymousId: 'anon_x',
      customerId: '11111111-2222-4333-8444-555555555555', dedupeKey: 'attacker', schemaVersion: 99, producer: 'x',
    });
    expect(out).toEqual({ eventType: 'PRODUCT_ADDED_TO_CART', productId: 'p1', anonymousId: 'anon_x' });
    expect(toPublicRecommendationEventInput({ eventType: 'PRODUCT_VIEWED', customerId: 'forged' }, 'session-user').customerId).toBe('session-user');
  });
});

// ── Browser telemetry authority ─────────────────────────────────────────────

describe('a browser may observe, not name who it is', () => {
  const ev = (over: Record<string, unknown> = {}) => ({
    event_name: 'add_to_cart', event_id: '6f0c5f7e-1b1a-4c1e-9d3a-000000000009', event_time: Math.floor(Date.parse('2026-09-24T10:00:00Z') / 1000),
    source: 'browser', ...over,
  });

  it('v1: user_id and every hashed identifier are dropped, and the server visitor id wins', () => {
    const out = withoutBrowserAuthority(ev({
      user_data: { user_id: 'u', hashed_email: 'e', hashed_phone: 'p', hashed_phone_plus: 'pp', hashed_email_google: 'eg', fp_client_id: 'fp.page', gclid: 'g' },
    }) as never, 'fp.server');
    expect(out.user_data).toEqual({ fp_client_id: 'fp.server', gclid: 'g' });
  });

  it('an impossible basket value is refused', () => {
    expect(exceedsBrowserValueCeiling({ ecommerce: { value: 999_999_999_999 } })).toBe(true);
    expect(exceedsBrowserValueCeiling({ ecommerce: { value: 150_000, items: [{ price: 999_999_999_999 }] } })).toBe(true);
    expect(exceedsBrowserValueCeiling({ ecommerce: { value: 150_000, items: [{ price: 150_000 }] } })).toBe(false);
  });

  it('v2: the two hashed keys the old list missed, stale event times and absurd values are rejected per event', async () => {
    const now = new Date('2026-09-24T10:00:00Z');
    const store: CollectorStore = { findBatch: async () => null, saveBatch: async () => 'SAVED', saveTouch: async () => undefined };
    const tracked: unknown[] = [];
    const uc = new CollectBrowserBatchUseCase(store, async (e) => { tracked.push(e); }, () => now);
    const body = JSON.stringify({
      batchId: '7f0c5f7e-1b1a-4c1e-9d3a-00000000000a', schemaVersion: 1, events: [
        ev({ event_id: '6f0c5f7e-1b1a-4c1e-9d3a-000000000001', user_data: { hashed_phone_plus: 'x' } }),
        ev({ event_id: '6f0c5f7e-1b1a-4c1e-9d3a-000000000002', user_data: { hashed_email_google: 'x' } }),
        ev({ event_id: '6f0c5f7e-1b1a-4c1e-9d3a-000000000003', event_time: Math.floor(now.getTime() / 1000) - 400 * 86_400 }),
        ev({ event_id: '6f0c5f7e-1b1a-4c1e-9d3a-000000000004', ecommerce: { value: 1e12, currency: 'UGX' } }),
        ev({ event_id: '6f0c5f7e-1b1a-4c1e-9d3a-000000000005' }),
      ],
    });
    const r: any = await uc.execute(body);
    expect(r.status).toBe(202);
    expect(r.receipt.rejected.map((x: any) => x.reason)).toEqual([
      'SERVER_AUTHORITY_FIELD', 'SERVER_AUTHORITY_FIELD', 'EVENT_TIME_OUT_OF_RANGE', 'VALUE_OUT_OF_RANGE',
    ]);
    expect(tracked).toHaveLength(1);
  });

  it('/telemetry/identity takes a schema-bounded body, behind the bot gate and a streaming cap, and no user_id', () => {
    const src = read('apps/api/src/interfaces/http/routes/telemetry.ts');
    expect(src).toContain("routes.post('/identity', identityLimit, botDetectionMiddleware");
    expect(src).toContain('IdentitySignalSchema.safeParse');
    const schema = src.slice(src.indexOf('const IdentitySignalSchema'), src.indexOf("routes.post('/identity'"));
    expect(schema).not.toMatch(/user_id|email|phone/);
  });
});

// ── Body caps that hold for chunked uploads ─────────────────────────────────

function chunkedRequest(bytes: number, url = 'http://x/') {
  const chunk = new Uint8Array(1024).fill(97);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= bytes) { controller.close(); return; }
      controller.enqueue(chunk);
      sent += chunk.byteLength;
    },
  });
  return { req: new Request(url, { method: 'POST', body, duplex: 'half' } as RequestInit), sentBytes: () => sent };
}

describe('body caps are enforced while the body streams', () => {
  it('readBodyCapped stops a chunked upload at the cap instead of buffering all of it', async () => {
    const { req, sentBytes } = chunkedRequest(5 * 1024 * 1024);
    expect(req.headers.get('content-length')).toBeNull();
    const r = await readBodyCapped(req, 8 * 1024);
    expect(r).toEqual({ ok: false, reason: 'TOO_LARGE' });
    expect(sentBytes()).toBeLessThan(64 * 1024);
  });

  it('readBodyCapped refuses a declared oversize body and returns a small one intact', async () => {
    const big = new Request('http://x/', { method: 'POST', body: 'x'.repeat(10), headers: { 'content-length': '999999' } });
    expect((await readBodyCapped(big, 100)).ok).toBe(false);
    expect(await readBodyCapped(new Request('http://x/', { method: 'POST', body: '{"a":"é"}' }), 100)).toEqual({ ok: true, text: '{"a":"é"}' });
  });

  it("hono's bodyLimit (used on the API collectors) refuses a chunked body with no Content-Length", async () => {
    const app = new Hono();
    app.post('/z', bodyLimit({ maxSize: 32_000, onError: (c: any) => c.json({ error: 'PAYLOAD_TOO_LARGE' }, 413) }), async (c: any) => {
      await c.req.text();
      return c.json({ ok: true }, 201);
    });
    const { req } = chunkedRequest(2 * 1024 * 1024, 'http://x/z');
    expect((await app.request(req)).status).toBe(413);
  });

  it('every public relay and the blog proxy read through the streaming cap', () => {
    for (const f of [
      'apps/web/src/pages/api/rec/[...path].ts',
      'apps/web/src/pages/api/hero/events.ts',
      'apps/web/src/pages/api/nav/events.ts',
      'apps/web/src/pages/api/battery-request.ts',
      'apps/web/src/pages/api/admin/blog/[...path].ts',
    ]) {
      const src = read(f);
      expect(src, f).toContain('readBodyCapped(request, MAX_BODY_BYTES)');
      expect(src, f).not.toMatch(/await request\.(text|json)\(\)/);
    }
    for (const [f, route] of [
      ['apps/api/src/interfaces/http/routes/telemetry.ts', "routes.post('/collect', collectLimit"],
      ['apps/api/src/interfaces/http/routes/telemetry.ts', "routes.post('/collect/batch', batchLimit"],
      ['apps/api/src/interfaces/http/routes/measurement.ts', "routes.post('/zero-party', zeroPartyLimit"],
    ] as const) {
      expect(read(f), route).toContain(route);
    }
  });

  it('the hero, nav and signals relays forward the visitor address so abuse control applies', () => {
    for (const f of ['apps/web/src/pages/api/hero/events.ts', 'apps/web/src/pages/api/nav/events.ts', 'apps/web/src/pages/api/hero/signals.ts']) {
      expect(read(f), f).toContain('headers["X-Forwarded-For"] = clientAddress');
    }
  });
});

// ── Measurement surfaces ────────────────────────────────────────────────────

describe('measurement surfaces', () => {
  it('the DLQ list carries six display fields and nothing about the visitor', async () => {
    const uc = new ListMeasurementDlqUseCase({
      listUnresolved: async () => [{
        id: 'd1', originalOutboxEventId: 'o1', eventName: 'add_to_cart', eventId: 'e1', totalAttempts: 3, failedReason: '500', failedAt: 'T',
        payload: { user_data: { ip_address: '1.2.3.4', user_agent: 'UA', hashed_email: 'h' } },
      }],
    } as never);
    const rows = await uc.execute(10);
    expect(rows).toEqual([{ id: 'd1', eventName: 'add_to_cart', eventId: 'e1', totalAttempts: 3, failedReason: '500', failedAt: 'T' }]);
    expect(JSON.stringify(rows)).not.toMatch(/1\.2\.3\.4|UA|hashed/);
  });

  it('a zero-party signal belongs to the session, never to a user_id in the body', async () => {
    const consentAsked: Array<string | undefined> = [];
    const stored: any[] = [];
    const uc = new CaptureZeroPartyDataUseCase(
      { insertSignal: async (s: any) => { stored.push(s); return { id: 'z1' }; } } as never,
      { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
      { getCurrentState: async (_fp: string, userId?: string) => { consentAsked.push(userId); return { personalization: true }; } } as never,
    );
    const victim = '11111111-2222-4333-8444-555555555555';
    await uc.execute({ fp_client_id: 'fp.x', user_id: victim, signal_type: 'feedback', payload: {} } as never);
    expect(consentAsked).toEqual([undefined]);
    expect(stored[0].user_id).toBeUndefined();
    await uc.execute({ fp_client_id: 'fp.x', user_id: victim, signal_type: 'feedback', payload: {} } as never, undefined, undefined, 'session-user');
    expect(consentAsked[1]).toBe('session-user');
    expect(stored[1].user_id).toBe('session-user');
  });

  it('the zero-party answer does not reveal whether it was kept; match-quality is operator-only and validates days', () => {
    const src = read('apps/api/src/interfaces/http/routes/measurement.ts');
    expect(src).not.toContain('captured: result.captured');
    expect(src).toContain("c.get('userId') ?? null");
    expect(src).toContain("routes.get('/match-quality', authMiddleware, requirePermissions([PERMISSIONS.REPORTS_READ])");
    expect(src).toContain('Number.isInteger(days)');
    expect(read('apps/api/src/interfaces/http/routes/admin/measurement.ts')).toContain('Number.isInteger(days)');
  });

  it('the retired purchase path is gone and the synthetic check waits on the authoritative event', () => {
    expect(existsSync(resolve(ROOT, 'apps/api/src/application/use-cases/telemetry/EnqueuePurchaseEventUseCase.ts'))).toBe(false);
    expect(existsSync(resolve(ROOT, 'apps/api/src/infrastructure/telemetry/PurchaseTelemetry.ts'))).toBe(false);
    const monitor = read('apps/api/src/infrastructure/scheduler/SyntheticMonitor.ts');
    expect(monitor).toContain("event_name = 'order_confirmed'");
    expect(monitor).not.toContain('`purchase:${webhookPayload.providerReference}`');
    expect(read('apps/api/src/interfaces/http/routes/webhooks.ts')).not.toContain('infrastructure/telemetry/PurchaseTelemetry');
  });

  it('the orphaned /seo/battery-finder records nothing', () => {
    const src = read('apps/api/src/interfaces/http/routes/seo.ts');
    const block = src.slice(src.indexOf("routes.get('/battery-finder'"));
    expect(block).toContain('recordEvent: async () => undefined');
    expect(block.slice(0, 2000)).not.toContain('repo.recordFinderEvent');
  });
});

// ── Maintenance freeze ──────────────────────────────────────────────────────

describe('the maintenance freeze', () => {
  it('still lets payment notifications and the way back in through', () => {
    for (const p of ['/commerce/payments/pesapal/ipn', '/webhooks/payment/mtn', '/auth/login', '/auth/admin/login', '/auth/refresh', '/auth/mfa/verify', '/admin/deployment/maintenance', '/health']) {
      expect(isMaintenanceExempt(p), p).toBe(true);
    }
  });
  it('and still freezes ordinary writes', () => {
    for (const p of ['/auth/register', '/commerce/checkout', '/admin/products/x', '/auth/mfa/enrol']) {
      expect(isMaintenanceExempt(p), p).toBe(false);
    }
  });
});

// ── Controlled activation refusals ──────────────────────────────────────────

describe('controlled-activation refusals answer with their reason, not a 500', () => {
  it('maps the use cases\' own refusals and leaves everything else to the global handler', () => {
    expect(activationRefusal(new Error('Activation request not found'))).toMatchObject({ status: 404 });
    expect(activationRefusal(new Error('Forbidden: Cannot approve activation'))).toMatchObject({ status: 403, message: 'You are not allowed to do that.' });
    const sod = activationRefusal(new Error('Separation of duties: the admin who requested this activation cannot approve it. A second approver is required.'));
    expect(sod).toMatchObject({ status: 409 });
    expect(sod?.message).toContain('Separation of duties');
    expect(activationRefusal(new Error('Cannot approve without rollback plan'))).toMatchObject({ status: 409 });
    expect(activationRefusal(new Error('connection terminated unexpectedly'))).toBeNull();
    expect(activationRefusal(Object.assign(new Error('value not found in index'), { code: '22P02' }))).toBeNull();
    expect(activationRefusal('string')).toBeNull();
  });

  it('a sub-router onError that rethrows still reaches the app-wide handler', async () => {
    const child = new Hono();
    child.onError((err: Error, c: any) => {
      const r = activationRefusal(err);
      if (!r) throw err;
      return c.json({ error: r.code }, r.status);
    });
    child.get('/known', () => { throw new Error('Activation request not found'); });
    child.get('/unknown', () => { throw new Error('boom'); });
    const app = new Hono();
    app.onError((_e: Error, c: any) => c.json({ error: 'INTERNAL' }, 500));
    app.route('/a', child);
    expect((await app.request('/a/known')).status).toBe(404);
    const unknown = await app.request('/a/unknown');
    expect(unknown.status).toBe(500);
    expect(await unknown.json()).toEqual({ error: 'INTERNAL' });
  });

  it('release-readiness bodies are parsed defensively with a status vocabulary', () => {
    const src = read('apps/api/src/interfaces/http/routes/admin/release-readiness.ts');
    expect(src).not.toMatch(/const body = await c\.req\.json\(\);/);
    expect(src).toContain('ReleaseDecisionBody.safeParse(await c.req.json().catch(() => null))');
    expect(src).toContain("z.enum(RELEASE_DECISION_STATUSES)");
  });
});

// ── Merchant feed and retired pages ─────────────────────────────────────────

describe('what the merchant feed and the sitemap say', () => {
  const base = (over: Partial<FeedProduct> = {}): FeedProduct => ({
    sku: 'GP-1', slug: 'gp-1', name: 'GoldPlus 20W USB-C Charger', shortDescription: 'x', priceUgx: 150_000, stockStatus: 'in_stock',
    imageUrl: '/i.webp', modelNumber: null, isFeedEligible: true, active: true, approvalStatus: 'approved', ...over,
  });

  it('availability follows units available to a new order, as the product page does', () => {
    // Last unit held by a pending order: the page says OutOfStock, so must the feed.
    expect(feedAvailability(base({ stockStatus: 'in_stock', stockQuantity: 1, reservedQuantity: 1 }))).toBe('out of stock');
    // Admin-set in_stock with nothing on hand.
    expect(feedAvailability(base({ stockStatus: 'in_stock', stockQuantity: 0, reservedQuantity: 0 }))).toBe('out of stock');
    // A buyable low-stock item was advertised as out of stock.
    expect(feedAvailability(base({ stockStatus: 'low_stock', stockQuantity: 2, reservedQuantity: 0 }))).toBe('in stock');
    expect(feedAvailability(base({ stockStatus: 'out_of_stock', stockQuantity: 0, isPreOrderEnabled: true }))).toBe('preorder');
    expect(buildMerchantFeedXml([base({ stockQuantity: 3, reservedQuantity: 3 })])).toContain('<g:availability>out of stock</g:availability>');
  });

  it('a caller without quantities keeps the status mapping', () => {
    expect(feedAvailability(base({ stockStatus: 'pre_order' }))).toBe('preorder');
    expect(feedAvailability(base({ stockStatus: 'in_stock' }))).toBe('in stock');
  });

  it('retired pages are left out of the sitemap and the feed, by the same rule the page obeys', () => {
    const rule = read('apps/api/src/infrastructure/db/LifecycleVisibilitySql.ts');
    for (const d of ['GONE_410', 'UNPUBLISH', 'REDIRECT_301_SUCCESSOR', 'REDIRECT_301_REPLACEMENT', 'OFFER_ALTERNATIVE']) expect(rule).toContain(d);
    const sitemap = read('apps/api/src/infrastructure/db/repositories/DrizzleSeoRepository.ts');
    expect(sitemap.match(/notRetiredByLifecycle\(sql`\$\{products\.id\}`\)/g)?.length).toBe(2);
    const feed = read('apps/api/src/infrastructure/db/repositories/DrizzleSeoGrowthRepository.ts');
    expect(feed).toContain("notRetiredByLifecycle(sql.raw('p.id'))");
    expect(feed).toContain('p.stock_quantity, p.reserved_quantity, p.is_pre_order_enabled');
  });

  it('a gone product page answers 410 with words and a way on, not an empty body', () => {
    const pdp = read('apps/web/src/pages/products/[slug].astro');
    expect(pdp).not.toMatch(/return Astro\.redirect\('\/404', 410\)/);
    expect(pdp).toContain('is no longer available</h1>');
    expect(pdp).toContain('status: 410');
  });
});

// ── Agent documents, llms.txt, the rail ─────────────────────────────────────

describe('machine-readable product facts match the page', () => {
  it('sample placeholder frames are never a product photo', () => {
    const urls = realProductImageUrls({
      images: [
        { url: '/sample-cover.webp', alt: 'Sample image (no photo of this product yet)' },
        { url: '/real.webp', alt: 'GoldPlus charger front' },
        { url: '/sample-2.webp', alt: 'Sample view 2' },
      ],
    } as never);
    expect(urls).toEqual(['/real.webp']);
  });

  it('the quoted price is what the shop charges, floor included', () => {
    const d = { active: true, percentBps: 1000, priceFloorUgx: 0 };
    expect(chargedPriceUgx({ retailPriceUgx: 185_000, floorPriceUgx: 100_000 } as never, d)).toBe(166_500);
    // At the product's own floor the campaign takes nothing off; no floor = not discountable.
    expect(chargedPriceUgx({ retailPriceUgx: 145_000, floorPriceUgx: 145_000 } as never, d)).toBe(145_000);
    expect(chargedPriceUgx({ retailPriceUgx: 185_000, floorPriceUgx: null } as never, d)).toBe(185_000);
    expect(chargedPriceUgx({ retailPriceUgx: 185_000, floorPriceUgx: 100_000 } as never, { active: false, percentBps: 0, priceFloorUgx: 0 })).toBe(185_000);
    expect(chargedPriceUgx({ retailPriceUgx: null, floorPriceUgx: null } as never, d)).toBeNull();
  });

  it('agent documents use those rules, honour lifecycle decisions and never state counts from a partial read', () => {
    const docs = read('apps/web/src/lib/agentDocuments.ts');
    expect(docs).not.toContain('node.image = absolute(p.primaryImageUrl)');
    expect(docs).toContain('realProductImageUrls(p)');
    expect(docs).not.toMatch(/ugx\(p\.retailPriceUgx\)|price: p\.retailPriceUgx/);
    expect(docs).toContain('/seo/product-lifecycle?productId=');
    expect(docs).toContain('if (lifecycle.retired) return null;');
    expect(docs).toContain('const products = read.complete ? read.products : [];');
  });

  it('llms.txt and the rail endpoint only state catalogue facts from a complete read', () => {
    const llms = read('apps/web/src/pages/llms.txt.ts');
    expect(llms).toContain('fetchApprovedCatalogueWithStatus(apiBase)');
    expect(llms).toContain("complete ? 'public, max-age=3600' : 'public, max-age=60'");
    expect(llms).toContain('chargedPriceUgx(p, discount)');
    const live = read('apps/web/src/pages/api/catalogue-live.ts');
    expect(live).toContain('if (!read.complete || catalogue.length === 0)');
    const rail = read('apps/web/src/components/recommendations/RecentlyViewedRail.astro');
    expect(rail).toContain('if (!liveOk) return { ...item, price: undefined, sale: null, availability: undefined };');
  });

  it('the reset token leaves the address bar before any measurement tag can read it', () => {
    const src = read('apps/web/src/pages/reset-password.astro');
    const redirect = src.indexOf("return Astro.redirect('/reset-password', 303)");
    expect(redirect).toBeGreaterThan(-1);
    expect(src.indexOf('httpOnly: true')).toBeLessThan(redirect);
    expect(src).toContain("path: '/reset-password'");
    expect(src).toContain('Astro.cookies.get(RESET_TOKEN_COOKIE)');
  });
});
