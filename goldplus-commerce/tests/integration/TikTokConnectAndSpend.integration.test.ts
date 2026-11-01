import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * TikTok's advertiser authorisation and spend import, end to end: the real
 * Registry and real PostgreSQL, with only TikTok's HTTP endpoints stubbed.
 *
 *   one-time code → exchanged → the token is stored ENCRYPTED on the TikTok
 *   audiences capability → spend import borrows it → campaign-by-day spend
 *   lands in the one spend table, in the account's currency.
 */
const URL_ = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL_ && process.env.DATABASE_URL ? describe : describe.skip;

suite('TikTok: authorisation to stored token to spend import (real Registry, real PostgreSQL)', () => {
  let raw: any;
  let ops: any;
  let vault: any;
  let previous: any[] = [];
  const realFetch = globalThis.fetch;
  const APP_ID = '7412345678901234567';
  const SECRET = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
  const ADV = `73${String(Date.now()).padStart(17, '0').slice(-17)}`;
  const TOKEN = 'tt_long_term_token_' + 'q'.repeat(40);
  const calls: Array<{ path: string; token: string | null; body: any; query: URLSearchParams }> = [];
  let oauthAnswer: (body: any) => unknown = () => ({ code: 0, message: 'OK', data: { access_token: TOKEN, advertiser_ids: [ADV], scope: [4] } });

  beforeAll(async () => {
    process.env.SEO_CREDENTIAL_VAULT_KEY = 'it-vault-key-for-tiktok-connect-and-spend-test';
    // Installed BEFORE the Registry is built: its gateways keep the fetch they were made with.
    globalThis.fetch = (async (input: any, init: any) => {
      const u = new URL(String(input));
      if (u.hostname !== 'business-api.tiktok.com') return realFetch(input, init);
      const body = init?.body ? JSON.parse(init.body) : null;
      calls.push({ path: u.pathname, token: init?.headers?.['Access-Token'] ?? null, body, query: u.searchParams });
      if (u.pathname.endsWith('/oauth2/access_token/')) return new Response(JSON.stringify(oauthAnswer(body)), { status: 200 });
      if (u.pathname.endsWith('/advertiser/info/')) return new Response(JSON.stringify({ code: 0, data: { list: [{ advertiser_id: ADV, currency: 'USD' }] } }), { status: 200 });
      if (u.pathname.endsWith('/report/integrated/get/')) return new Response(JSON.stringify({ code: 0, data: { page_info: { page: 1, total_page: 1 }, list: [
        { dimensions: { campaign_id: '1800000000000001', stat_time_day: '2026-09-20 00:00:00' }, metrics: { campaign_name: 'IT launch', spend: '12.34', impressions: '1000', clicks: '25' } },
        { dimensions: { campaign_id: '1800000000000001', stat_time_day: '2026-09-21 00:00:00' }, metrics: { campaign_name: 'IT launch', spend: '0.00', impressions: '0', clicks: '0' } },
      ] } }), { status: 200 });
      return new Response(JSON.stringify({ code: 40007, message: 'not stubbed' }), { status: 400 });
    }) as never;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('postgres')(URL_ as string, { max: 2, onnotice: () => undefined });
    previous = await raw`select * from ad_destination_capabilities where platform = 'tiktok'`;
    await raw`delete from ad_destination_capabilities where platform = 'tiktok'`;
    const { Registry } = await import('../../apps/api/src/infrastructure/Registry');
    ops = Registry.getInstance().advertisingOps;
    vault = (await import('../../apps/api/src/infrastructure/seo/IntegrationCredentialVault')).IntegrationCredentialVault.fromEnv()!;
  }, 90_000);

  afterAll(async () => {
    globalThis.fetch = realFetch;
    if (!raw) return;
    await raw`delete from media_cost_facts where platform = 'TikTok' and account = ${ADV}`;
    await raw`delete from ad_destination_capabilities where platform = 'tiktok'`;
    for (const r of previous) await raw`insert into ad_destination_capabilities ${raw(r)}`;
    await raw.end();
  });

  const row = async (capability: string) => (await raw`select enabled, config, secret_enc, secret_mask from ad_destination_capabilities where platform = 'tiktok' and capability = ${capability}`)[0];

  it('a code approved for another advertiser account stores nothing', async () => {
    oauthAnswer = () => ({ code: 0, message: 'OK', data: { access_token: TOKEN, advertiser_ids: ['7399999999999999999'] } });
    const r = await ops.tiktokConnect.connect(null, { appId: APP_ID, appSecret: SECRET, authCode: 'authcode_someone_elses_0123456789', advertiserId: ADV });
    expect(r.ok).toBe(false);
    expect((await row('audiences'))?.secret_enc ?? null).toBeNull();
  });

  it('TikTok\'s refusal of the code is reported with what to do, and stores nothing', async () => {
    oauthAnswer = () => ({ code: 40110, message: 'The auth_code is canceled.', request_id: 'r-used' });
    const r = await ops.tiktokConnect.connect(null, { appId: APP_ID, appSecret: SECRET, authCode: 'authcode_already_used_0123456789', advertiserId: ADV });
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toContain('TikTok error 40110');
    expect(r.message).toContain('start again from Connect TikTok');
    expect((await row('audiences'))?.secret_enc ?? null).toBeNull();
  });

  it('the right code is exchanged once and the token is stored encrypted, with the advertiser, not switched on', async () => {
    oauthAnswer = () => ({ code: 0, message: 'OK', data: { access_token: TOKEN, advertiser_ids: [ADV], scope: [4] } });
    const before = calls.length;
    const r = await ops.tiktokConnect.connect(null, { appId: APP_ID, appSecret: SECRET, authCode: 'authcode_the_real_one_0123456789', advertiserId: ADV });
    expect(r).toEqual({ ok: true, advertiserId: ADV });
    const exchange = calls.slice(before);
    expect(exchange).toHaveLength(1);
    expect(exchange[0].body).toEqual({ app_id: APP_ID, secret: SECRET, auth_code: 'authcode_the_real_one_0123456789' });
    const a = await row('audiences');
    expect(a.config.advertiserId).toBe(ADV);
    expect(a.enabled).toBe(false);                                        // connecting is not switching on
    expect(String(a.secret_enc)).not.toContain(TOKEN);                   // never in the clear
    expect(vault.decrypt(a.secret_enc).apiKey).toBe(TOKEN);
    expect(String(a.secret_mask)).not.toContain(TOKEN.slice(0, 12));
    // The app secret is nowhere in the database row.
    expect(JSON.stringify(a)).not.toContain(SECRET);
    const audit = await raw`select new_state::text as s from audit_logs where action = 'AD_TIKTOK_CONNECTED' order by created_at desc limit 1`;
    expect(audit[0].s).toContain(ADV);
    for (const secret of [TOKEN, SECRET, 'authcode_the_real_one']) expect(audit[0].s).not.toContain(secret);
  });

  it('spend import borrows that token and writes campaign-by-day spend in the account currency', async () => {
    const { DrizzleAdCapabilityRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAdvertisingOpsRepository');
    await new DrizzleAdCapabilityRepository().save('tiktok', 'spend', { enabled: true, config: { advertiserId: ADV }, updatedBy: null });
    const before = calls.length;
    const rec = await ops.spend.importFromApi('tiktok', 'ADMIN', null, { from: '2026-09-20', to: '2026-09-21' });
    expect(rec.message ?? '').toBe('');
    expect(rec).toMatchObject({ platform: 'tiktok', status: 'IMPORTED', rowsWritten: 2 });
    const made = calls.slice(before);
    expect(made.map((c) => c.path)).toEqual(['/open_api/v1.3/advertiser/info/', '/open_api/v1.3/report/integrated/get/']);
    for (const c of made) expect(c.token).toBe(TOKEN);                    // the audiences token, from the vault
    expect(made[1].query.get('advertiser_id')).toBe(ADV);
    const facts = await raw`select spend_date::text as d, currency, spend_minor, clicks, impressions, campaign, campaign_label, source from media_cost_facts where platform = 'TikTok' and account = ${ADV} order by spend_date`;
    expect(facts).toHaveLength(2);
    expect(facts[0]).toMatchObject({ d: '2026-09-20', currency: 'USD', campaign: 'id:1800000000000001', campaign_label: 'IT launch', source: 'tiktok_marketing_api' });
    expect(Number(facts[0].spend_minor)).toBe(1234);
    expect(Number(facts[0].clicks)).toBe(25);
    expect(Number(facts[1].spend_minor)).toBe(0);
    // Importing the same days again replaces them: nothing is doubled.
    await ops.spend.importFromApi('tiktok', 'ADMIN', null, { from: '2026-09-20', to: '2026-09-21' });
    expect(await raw`select 1 from media_cost_facts where platform = 'TikTok' and account = ${ADV}`).toHaveLength(2);
  }, 60_000);
});
