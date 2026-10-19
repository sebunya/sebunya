import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  ACCESS_CODE_TTL_MS,
  ACCESS_TTL_MS,
  MAX_CODES_PER_PHONE_PER_HOUR,
  MAX_CODE_ATTEMPTS,
  checkChallenge,
  issueAccessToken,
  maskPhone,
  readAccessToken,
  type AccessChallenge,
} from '../../apps/api/src/domain/quotes/BulkPriceAccess';
import {
  GetBulkTermsUseCase,
  StartBulkPriceAccessUseCase,
  VerifyBulkPriceAccessUseCase,
  type PriceAccessCrypto,
} from '../../apps/api/src/application/use-cases/quotes/BulkPriceAccessUseCases';
import type { IBulkPriceAccessRepository } from '../../apps/api/src/application/ports/IBulkPriceAccessRepository';
import type { BulkTerms, IBulkTermsRepository } from '../../apps/api/src/application/ports/IBulkTermsRepository';
import { classifyPublicEndpoint } from '../../apps/api/src/domain/security/PublicEndpointPolicy';

const sign = (body: string) => createHmac('sha256', 'test-key').update(body).digest('hex');
const NOW = new Date('2026-10-19T10:00:00Z');
const PHONE = '+256772123456';

describe('access token', () => {
  it('proves the phone until it expires, and nothing forged or altered passes', () => {
    const { token, expiresAt } = issueAccessToken(PHONE, NOW, sign);
    expect(expiresAt.getTime() - NOW.getTime()).toBe(ACCESS_TTL_MS);
    expect(readAccessToken(token, NOW, sign)).toBe(PHONE);
    expect(readAccessToken(token, new Date(expiresAt.getTime() - 1), sign)).toBe(PHONE);
    expect(readAccessToken(token, expiresAt, sign)).toBeNull();
    const [v, digits, exp, mac] = token.split('.');
    expect(readAccessToken([v, '256772999999', exp, mac].join('.'), NOW, sign)).toBeNull();
    expect(readAccessToken([v, digits, String(Number(exp) + 1), mac].join('.'), NOW, sign)).toBeNull();
    expect(readAccessToken([v, digits, exp, mac.replace(/.$/, mac.endsWith('0') ? '1' : '0')].join('.'), NOW, sign)).toBeNull();
    expect(readAccessToken(token, NOW, (b) => createHmac('sha256', 'other-key').update(b).digest('hex'))).toBeNull();
    for (const junk of [undefined, null, 42, '', 'b1.x.y.z', `${token}.extra`]) expect(readAccessToken(junk, NOW, sign)).toBeNull();
  });

  it('masks the phone for a shared screen', () => {
    expect(maskPhone(PHONE)).toBe('0772 •••456');
  });
});

describe('code challenge', () => {
  const challenge = (over: Partial<AccessChallenge> = {}): AccessChallenge => ({
    id: 'c1', codeHash: 'h-123456', attempts: 1, expiresAt: new Date(NOW.getTime() + 60_000), verifiedAt: null, ...over,
  });
  it('accepts the right code once, in time, within the attempts', () => {
    expect(checkChallenge(challenge(), 'h-123456', NOW)).toEqual({ ok: true });
    expect(checkChallenge(challenge(), 'h-000000', NOW)).toEqual({ ok: false, code: 'WRONG_CODE' });
    expect(checkChallenge(challenge({ expiresAt: NOW }), 'h-123456', NOW)).toEqual({ ok: false, code: 'EXPIRED' });
    expect(checkChallenge(challenge({ attempts: MAX_CODE_ATTEMPTS + 1 }), 'h-123456', NOW)).toEqual({ ok: false, code: 'TOO_MANY_ATTEMPTS' });
    expect(checkChallenge(challenge({ verifiedAt: NOW }), 'h-123456', NOW)).toEqual({ ok: false, code: 'NO_CODE' });
    expect(checkChallenge(null, 'h-123456', NOW)).toEqual({ ok: false, code: 'NO_CODE' });
  });
});

function fakeAccess(): IBulkPriceAccessRepository & { rows: Array<AccessChallenge & { phone: string; createdAt: Date }> } {
  const rows: Array<AccessChallenge & { phone: string; createdAt: Date }> = [];
  let n = 0;
  return {
    rows,
    countSince: async (phone, since) => rows.filter((r) => r.phone === phone && r.createdAt >= since).length,
    create: async ({ phone, codeHash, expiresAt }) => { rows.push({ id: `c${++n}`, phone, codeHash, expiresAt, attempts: 0, verifiedAt: null, createdAt: NOW }); },
    latestOpen: async (phone) => [...rows].reverse().find((r) => r.phone === phone && !r.verifiedAt) ?? null,
    recordAttempt: async (id) => { const r = rows.find((x) => x.id === id)!; r.attempts += 1; return r.attempts; },
    markVerified: async (id, at) => { const r = rows.find((x) => x.id === id)!; if (r.verifiedAt) return false; r.verifiedAt = at; return true; },
    listVerified: async () => rows.filter((r) => r.verifiedAt).map((r) => ({ phone: r.phone, verifiedAt: r.verifiedAt! })),
  };
}

const crypto: PriceAccessCrypto = { newCode: () => '123456', hashCode: (c) => `h-${c}`, sign };

describe('start and verify', () => {
  it('texts a code to the normalised phone, then the right code earns a token for that phone', async () => {
    const access = fakeAccess();
    const sent: Array<[string, string]> = [];
    const start = new StartBulkPriceAccessUseCase(access, { send: async (p, c) => { sent.push([p, c]); } }, crypto, () => NOW);
    expect(await start.execute({ phone: '0772 123 456' })).toEqual({ ok: true, maskedPhone: '0772 •••456' });
    expect(sent).toEqual([[PHONE, '123456']]);
    expect(access.rows[0]).toMatchObject({ phone: PHONE, codeHash: 'h-123456' });
    expect(access.rows[0].expiresAt.getTime() - NOW.getTime()).toBe(ACCESS_CODE_TTL_MS);

    const verify = new VerifyBulkPriceAccessUseCase(access, crypto, () => NOW);
    expect(await verify.execute({ phone: '0772123456', code: '000000' })).toMatchObject({ ok: false, code: 'WRONG_CODE' });
    const ok = await verify.execute({ phone: '0772123456', code: '123 456' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(readAccessToken(ok.token, NOW, sign)).toBe(PHONE);
    // A code works once.
    expect(await verify.execute({ phone: '0772123456', code: '123456' })).toMatchObject({ ok: false, code: 'NO_CODE' });
  });

  it('caps codes per phone per hour and refuses a bad phone', async () => {
    const access = fakeAccess();
    const start = new StartBulkPriceAccessUseCase(access, { send: async () => undefined }, crypto, () => NOW);
    for (let i = 0; i < MAX_CODES_PER_PHONE_PER_HOUR; i++) expect((await start.execute({ phone: '0772123456' })).ok).toBe(true);
    expect(await start.execute({ phone: '0772123456' })).toMatchObject({ ok: false, code: 'TOO_MANY_CODES' });
    expect(await start.execute({ phone: '12' })).toMatchObject({ ok: false, code: 'BAD_PHONE' });
  });

  it('counts every guess, so five wrong tries end the code', async () => {
    const access = fakeAccess();
    await new StartBulkPriceAccessUseCase(access, { send: async () => undefined }, crypto, () => NOW).execute({ phone: '0772123456' });
    const verify = new VerifyBulkPriceAccessUseCase(access, crypto, () => NOW);
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) await verify.execute({ phone: '0772123456', code: '000000' });
    expect(await verify.execute({ phone: '0772123456', code: '123456' })).toMatchObject({ ok: false, code: 'TOO_MANY_ATTEMPTS' });
  });
});

describe('bulk terms read: the one public read of the dealer price', () => {
  const rows: BulkTerms[] = [
    { productId: 'a', bulkUnit: 'carton', unitsPerCarton: 50, dealerPriceUgx: 21_000 },
    { productId: 'f', bulkUnit: 'piece', unitsPerCarton: null, dealerPriceUgx: null },
  ];
  const repo: IBulkTermsRepository = { findOnSale: async () => rows, listForAdmin: async () => [], update: async () => 'updated' };
  const uc = new GetBulkTermsUseCase(repo, { sign }, () => NOW);

  it('gives carton terms to anyone and never a price without a valid token', async () => {
    for (const token of [undefined, 'forged', issueAccessToken(PHONE, new Date(NOW.getTime() - ACCESS_TTL_MS - 1), sign).token]) {
      const r = await uc.execute({ token });
      expect(r).toEqual({
        pricesUnlocked: false,
        maskedPhone: null,
        terms: [{ productId: 'a', bulkUnit: 'carton', unitsPerCarton: 50 }, { productId: 'f', bulkUnit: 'piece', unitsPerCarton: null }],
      });
      expect(JSON.stringify(r)).not.toMatch(/21000|Price/);
    }
  });

  it('adds the price per piece for a verified phone', async () => {
    const r = await uc.execute({ token: issueAccessToken(PHONE, NOW, sign).token });
    expect(r.pricesUnlocked).toBe(true);
    expect(r.maskedPhone).toBe('0772 •••456');
    expect(r.terms[0]).toEqual({ productId: 'a', bulkUnit: 'carton', unitsPerCarton: 50, bulkPriceUgx: 21_000 });
    expect(r.terms[1]).toMatchObject({ bulkPriceUgx: null });
  });
});

describe('rate families', () => {
  it('the code steps get the tight recovery budget; the terms read the lookup budget', () => {
    expect(classifyPublicEndpoint('POST', '/quotes/price-access/start')).toBe('auth-recovery');
    expect(classifyPublicEndpoint('POST', '/quotes/price-access/verify')).toBe('auth-recovery');
    expect(classifyPublicEndpoint('POST', '/quotes/bulk-terms')).toBe('order-lookup');
  });
});
