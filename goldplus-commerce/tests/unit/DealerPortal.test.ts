import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { issueDealerToken, readDealerToken } from '../../apps/api/src/domain/dealers/DealerPortalAccess';
import { issueAccessToken } from '../../apps/api/src/domain/quotes/BulkPriceAccess';
import { GetDealerAccountUseCase, StartDealerSignInUseCase, VerifyDealerSignInUseCase } from '../../apps/api/src/application/use-cases/dealers/DealerPortalUseCases';
import { classifyPublicEndpoint } from '../../apps/api/src/domain/security/PublicEndpointPolicy';

const sign = (b: string) => createHmac('sha256', 'k').update(b).digest('hex');
const crypto = { newCode: () => '123456', hashCode: (c: string) => `h:${c}`, sign };
const NOW = new Date('2026-10-20T10:00:00Z');

function accessRepo(usesBefore = 0) {
  const challenges: any[] = [];
  return {
    challenges,
    countUses: async () => usesBefore,
    countSince: async () => challenges.length,
    recordFirstVisit: async () => undefined,
    create: async (c: any) => { challenges.push({ id: `c${challenges.length}`, ...c, attempts: 0, verifiedAt: null }); },
    latestOpen: async () => challenges.at(-1) ?? null,
    recordAttempt: async () => 1,
    markVerified: async () => true,
  } as any;
}

describe('dealer portal (gap #16)', () => {
  it('a portal token opens the portal; a bulk-price token never does', () => {
    const portal = issueDealerToken('+256772123456', NOW, sign).token;
    expect(readDealerToken(portal, NOW, sign)).toBe('+256772123456');
    const bulk = issueAccessToken('+256772123456', NOW, sign).token;
    expect(readDealerToken(bulk, NOW, sign)).toBeNull();
    expect(readDealerToken(portal.replace(/.$/, (c) => (c === '0' ? '1' : '0')), NOW, sign)).toBeNull();
    expect(readDealerToken(portal, new Date(NOW.getTime() + 8 * 86_400_000), sign)).toBeNull();
  });

  it('sign-in always texts a code, even on a number never seen before (no no-code first visit)', async () => {
    const sent: string[] = [];
    const repo = accessRepo(0);
    const r = await new StartDealerSignInUseCase(repo, { send: async (p: string, c: string) => { sent.push(`${p}:${c}`); } }, crypto, () => NOW).execute({ phone: '0772123456' });
    expect(r).toMatchObject({ ok: true });
    expect(sent).toEqual(['+256772123456:123456']);
    const bad = await new StartDealerSignInUseCase(repo, { send: async () => undefined }, crypto, () => NOW).execute({ phone: '123' });
    expect(bad).toMatchObject({ ok: false, code: 'BAD_PHONE' });
  });

  it('the right code gives a portal token that reads that phone\'s own account', async () => {
    const repo = accessRepo(3);
    await new StartDealerSignInUseCase(repo, { send: async () => undefined }, crypto, () => NOW).execute({ phone: '0772123456' });
    const v = await new VerifyDealerSignInUseCase(repo, crypto, () => NOW).execute({ phone: '0772123456', code: '123456' });
    expect(v.ok).toBe(true);
    let askedFor = '';
    const acct = await new GetDealerAccountUseCase({ account: async (p: string) => { askedFor = p; return { application: null, quotes: [], orders: [], statement: [] }; } }, crypto, () => NOW).execute({ token: (v as any).token });
    expect(acct.ok).toBe(true);
    expect(askedFor).toBe('+256772123456');
    expect(await new GetDealerAccountUseCase({ account: async () => { throw new Error('never'); } } as any, crypto, () => NOW).execute({ token: 'junk' })).toEqual({ ok: false });
  });

  it('has the order-lookup budget per client', () => {
    expect(classifyPublicEndpoint('POST', '/quotes/dealer-portal/account')).toBe('order-lookup');
  });
});
