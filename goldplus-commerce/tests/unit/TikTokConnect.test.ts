import { describe, expect, it } from 'vitest';
import { TikTokConnectUseCases } from '../../apps/api/src/application/use-cases/advertising/TikTokConnectUseCases';
import { HttpTikTokOAuthGateway } from '../../apps/api/src/infrastructure/advertising/HttpTikTokOAuthGateway';

const APP_ID = '7412345678901234567';
const SECRET = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const CODE = 'authcode_0123456789abcdef';
const ADV = '7300000000000000001';
const TOKEN = 'tok_' + 'z'.repeat(40);

describe('TikTok authorisation: the exchange', () => {
  const stub = (status: number, body: unknown, seen: any[] = []) => (async (url: string, init: any) => { seen.push({ url: String(url), init }); return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }); }) as never;
  it('posts the app id, secret and code in the body to TikTok\'s fixed address and returns the token with the advertisers it covers', async () => {
    const seen: any[] = [];
    const r = await new HttpTikTokOAuthGateway(stub(200, `{"code":0,"message":"OK","data":{"access_token":"${TOKEN}","advertiser_ids":["${ADV}", 7300000000000000002],"scope":[1,2]}}`, seen)).exchange(APP_ID, SECRET, CODE);
    // The second ID is sent as a bare number: every digit survives.
    expect(r).toEqual({ ok: true, accessToken: TOKEN, advertiserIds: [ADV, '7300000000000000002'] });
    expect(seen[0].url).toBe('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/');
    expect(seen[0].url).not.toContain(SECRET);
    expect(JSON.parse(seen[0].init.body)).toEqual({ app_id: APP_ID, secret: SECRET, auth_code: CODE });
    expect(seen[0].init.redirect).toBe('manual');
  });
  it('a refusal is TikTok\'s own words with the secret and the code removed; no token, no success', async () => {
    const refused = await new HttpTikTokOAuthGateway(stub(200, { code: 40002, message: `auth_code ${CODE} is invalid for secret ${SECRET}`, request_id: 'r1' })).exchange(APP_ID, SECRET, CODE);
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(refused)).not.toContain(SECRET);
    expect(JSON.stringify(refused)).not.toContain(CODE);
    expect((refused as any).message).toContain('TikTok error 40002');
    // The refusals this exchange meets say what to do next.
    const used = await new HttpTikTokOAuthGateway(stub(400, { code: 40110, message: 'The auth_code is canceled.' })).exchange(APP_ID, SECRET, CODE);
    expect((used as any).message).toContain('start again from Connect TikTok');
    const mismatch = await new HttpTikTokOAuthGateway(stub(400, { code: 40101, message: 'Invalid auth_code.' })).exchange(APP_ID, SECRET, CODE);
    expect((mismatch as any).message).toContain('do not belong together');
    expect(await new HttpTikTokOAuthGateway(stub(200, { code: 0, data: {} })).exchange(APP_ID, SECRET, CODE)).toEqual({ ok: false, message: 'TikTok answered without an access token.' });
    expect((await new HttpTikTokOAuthGateway(stub(502, '<html>')).exchange(APP_ID, SECRET, CODE)).ok).toBe(false);
    const down = await new HttpTikTokOAuthGateway((async () => { throw new Error(`boom ${SECRET}`); }) as never).exchange(APP_ID, SECRET, CODE);
    expect(down.ok).toBe(false);
    expect(JSON.stringify(down)).not.toContain(SECRET);
  });
});

describe('TikTok authorisation: the use case', () => {
  const make = (answer: any = { ok: true, accessToken: TOKEN, advertiserIds: [ADV] }, saved: any = { ok: true }) => {
    const audits: any[] = []; const exchanges: any[] = []; const saves: any[] = [];
    const uc = new TikTokConnectUseCases({ exchange: async (...a: any[]) => { exchanges.push(a); if (answer instanceof Error) throw answer; return answer; } },
      async (actor, adv, tok) => { saves.push({ actor, adv, tok }); return saved; }, { execute: async (a: any) => { audits.push(a); } } as never);
    return { uc, audits, exchanges, saves };
  };
  const input = (over: Record<string, unknown> = {}) => ({ appId: APP_ID, appSecret: SECRET, authCode: CODE, advertiserId: ADV, ...over });

  it('stores the token for the advertiser TikTok says it covers, and audits it without the token, the secret or the code', async () => {
    const t = make();
    expect(await t.uc.connect('u1', input())).toEqual({ ok: true, advertiserId: ADV });
    expect(t.exchanges).toEqual([[APP_ID, SECRET, CODE]]);
    expect(t.saves).toEqual([{ actor: 'u1', adv: ADV, tok: TOKEN }]);
    expect(t.audits).toHaveLength(1);
    expect(t.audits[0]).toMatchObject({ action: 'AD_TIKTOK_CONNECTED', actorId: 'u1', newState: { advertiserId: ADV } });
    for (const s of [TOKEN, SECRET, CODE]) expect(JSON.stringify(t.audits)).not.toContain(s);
  });
  it('a code that was approved for somebody else\'s advertiser account is refused and nothing is stored', async () => {
    const t = make({ ok: true, accessToken: TOKEN, advertiserIds: ['7399999999999999999'] });
    const r = await t.uc.connect('u1', input());
    expect(r.ok).toBe(false);
    expect((r as any).message).toContain('not for advertiser ' + ADV);
    expect(t.saves).toHaveLength(0);
    expect(t.audits[0]).toMatchObject({ action: 'AD_TIKTOK_CONNECT_FAILED', newState: { reason: 'ADVERTISER_NOT_AUTHORISED' } });
    expect(JSON.stringify([r, t.audits])).not.toContain(TOKEN);
    const none = make({ ok: true, accessToken: TOKEN, advertiserIds: [] });
    expect((await none.uc.connect('u1', input()) as any).message).toContain('no advertiser account');
    expect(none.saves).toHaveLength(0);
  });
  it('bad input never reaches TikTok; TikTok\'s refusal and a failed save are reported and nothing is claimed', async () => {
    for (const bad of [{ authCode: '' }, { authCode: 'has space in it' }, { appId: 'abc' }, { appSecret: 'short' }, { advertiserId: '12' }]) {
      const t = make();
      expect((await t.uc.connect('u1', input(bad))).ok).toBe(false);
      expect(t.exchanges).toHaveLength(0);
      expect(t.saves).toHaveLength(0);
    }
    const refused = make({ ok: false, message: 'TikTok error 40002: auth_code expired' });
    expect(await refused.uc.connect('u1', input())).toEqual({ ok: false, message: 'TikTok error 40002: auth_code expired' });
    expect(refused.saves).toHaveLength(0);
    expect(refused.audits[0].action).toBe('AD_TIKTOK_CONNECT_FAILED');
    const thrown = make(new Error(`socket ${SECRET}`));
    const tr = await thrown.uc.connect('u1', input());
    expect(tr.ok).toBe(false);
    expect(JSON.stringify([tr, thrown.audits])).not.toContain(SECRET);
    const unsaved = make(undefined, { ok: false, message: 'Not configured: the credential vault key is not set on the server.' });
    expect(await unsaved.uc.connect('u1', input())).toEqual({ ok: false, message: 'Not configured: the credential vault key is not set on the server.' });
    expect(unsaved.audits.filter((a) => a.action === 'AD_TIKTOK_CONNECTED')).toHaveLength(0);
  });
});
