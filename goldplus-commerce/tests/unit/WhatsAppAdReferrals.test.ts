import { describe, expect, it } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import {
  businessMessagingPurchase, ctwaSecretProblem, ctwaWindowDays, messagingClickWins, metaClickTime, parseAdReferrals, parseCtwaSecrets,
  subscriptionChallenge, verifyWebhookSignature,
} from '../../apps/api/src/domain/advertising/WhatsAppAdReferrals';
import { WhatsAppAdsUseCases, type CtwaSettings } from '../../apps/api/src/application/use-cases/advertising/WhatsAppAdsUseCases';
import type { StoredWhatsAppReferral, WhatsAppAdReferralRepository } from '../../apps/api/src/application/ports/WhatsAppAds';
import { AD_CAPABILITIES, capabilityDef } from '../../apps/api/src/application/use-cases/advertising/AdCapabilities';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const sign = (body: string, secret: string) => `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
const WABA = '102290129340398';
const APP_SECRET = '0123456789abcdef0123456789abcdef';
const CLID = 'ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO2E4Nx0-eM-GABDLOPaOdRMv-_zfUQ2a';

/** One inbound message as the WhatsApp Business Platform delivers it, begun from an advert. */
const delivery = (over: { wabaId?: string; from?: string; id?: string; ts?: number; referral?: unknown; field?: string } = {}) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: over.wabaId ?? WABA, changes: [{ field: over.field ?? 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '256700000000', phone_number_id: '106540352242922' },
    contacts: [{ profile: { name: 'Sarah Nakato' }, wa_id: over.from ?? '256772123456' }],
    messages: [{ from: over.from ?? '256772123456', id: over.id ?? 'wamid.HBgLMjU2NzcyMTIzNDU2FQIAEhgUM0E', timestamp: String(over.ts ?? 1_790_000_000), type: 'text',
      text: { body: 'Hello, is the 20000mAh power bank in stock? My address is Plot 4 Kira Road.' },
      ...(over.referral === null ? {} : { referral: over.referral ?? { source_url: 'https://fb.me/3cr4Wqqkv', source_type: 'ad', source_id: '120208964364990278', headline: 'Power banks from UGX 45,000', body: 'Chat with us', media_type: 'image', image_url: 'https://scontent.xx.fbcdn.net/x.jpg', ctwa_clid: CLID } }) }],
  } }] }],
});

describe('WhatsApp webhook: only Meta is believed', () => {
  it('accepts exactly Meta\'s signature of the raw body, and nothing else', () => {
    const body = JSON.stringify(delivery());
    expect(verifyWebhookSignature(body, sign(body, APP_SECRET), APP_SECRET)).toBe(true);
    expect(verifyWebhookSignature(body, sign(body, APP_SECRET).toUpperCase().replace('SHA256=', 'sha256='), APP_SECRET)).toBe(true);
    // One changed byte, another secret, a missing or malformed header, the older SHA-1 header's shape.
    expect(verifyWebhookSignature(`${body} `, sign(body, APP_SECRET), APP_SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body, 'f'.repeat(32)), APP_SECRET)).toBe(false);
    for (const bad of [undefined, null, '', 'sha256=', 'sha256=zz', `sha1=${'a'.repeat(40)}`, sign(body, APP_SECRET).slice(7)]) expect(verifyWebhookSignature(body, bad, APP_SECRET), String(bad)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body, ''), '')).toBe(false);          // no secret configured: nothing verifies
  });
  it('answers Meta\'s subscription check only for our own verify token', () => {
    const token = 'goldplus-webhook-verify-2026';
    expect(subscriptionChallenge({ mode: 'subscribe', token, challenge: '1158201444' }, token)).toBe('1158201444');
    expect(subscriptionChallenge({ mode: 'subscribe', token: 'guess', challenge: '1' }, token)).toBeNull();
    expect(subscriptionChallenge({ mode: 'unsubscribe', token, challenge: '1' }, token)).toBeNull();
    expect(subscriptionChallenge({ mode: 'subscribe', token, challenge: '<script>alert(1)</script>' }, token)).toBeNull();   // never echoed into a response
    expect(subscriptionChallenge({ mode: 'subscribe', token: '', challenge: '1' }, '')).toBeNull();
    expect(subscriptionChallenge({}, token)).toBeNull();
  });
});

describe('WhatsApp webhook: what is kept', () => {
  const now = new Date(1_790_000_100_000);
  it('keeps the advert\'s click id and a hash of the sender — never the number, the name or the message', () => {
    const p = parseAdReferrals(delivery(), WABA, now);
    expect(p).toMatchObject({ messages: 1, referralsWithoutClickId: 0, foreignEntries: 0 });
    expect(p.referrals).toEqual([{
      messageId: 'wamid.HBgLMjU2NzcyMTIzNDU2FQIAEhgUM0E', wabaId: WABA, phoneNumberId: '106540352242922',
      senderPhoneSha256: sha('256772123456'), ctwaClid: CLID,
      sourceType: 'ad', sourceId: '120208964364990278', sourceUrl: 'https://fb.me/3cr4Wqqkv', headline: 'Power banks from UGX 45,000',
      receivedAt: new Date(1_790_000_000_000),
    }]);
    const kept = JSON.stringify(p);
    for (const secret of ['256772123456', 'Sarah', 'Nakato', 'power bank in stock', 'Kira Road', 'scontent']) expect(kept, secret).not.toContain(secret);
    // The hash is the one a sale already carries (Meta's `ph`: E.164 digits, no plus).
    expect(parseAdReferrals(delivery({ from: '+256 772 123456' }), WABA, now).referrals[0].senderPhoneSha256).toBe(sha('256772123456'));
  });
  it('ignores what is not an attributable advert chat, and counts why', () => {
    // An ordinary message: no referral.
    expect(parseAdReferrals(delivery({ referral: null }), WABA, now)).toMatchObject({ referrals: [], messages: 1, referralsWithoutClickId: 0 });
    // An advert in WhatsApp Status: Meta sends the referral without a click id, so it cannot be credited.
    expect(parseAdReferrals(delivery({ referral: { source_type: 'ad', source_id: '1', headline: 'x' } }), WABA, now)).toMatchObject({ referrals: [], referralsWithoutClickId: 1 });
    expect(parseAdReferrals(delivery({ referral: { ctwa_clid: 'has spaces <script>' } }), WABA, now).referralsWithoutClickId).toBe(1);
    // Another business's account, a non-message change, something that is not a WhatsApp delivery at all.
    expect(parseAdReferrals(delivery({ wabaId: '999999999999999' }), WABA, now)).toMatchObject({ referrals: [], messages: 0, foreignEntries: 1 });
    expect(parseAdReferrals(delivery({ field: 'message_template_status_update' }), WABA, now)).toMatchObject({ referrals: [], messages: 0 });
    for (const junk of [null, undefined, {}, { object: 'page', entry: [] }, { object: 'whatsapp_business_account' }, 'text', 7]) expect(parseAdReferrals(junk, WABA, now).referrals).toEqual([]);
    // A sender that is not a phone number, or a message with no id, cannot be matched or deduplicated.
    expect(parseAdReferrals(delivery({ from: 'abc' }), WABA, now).referrals).toEqual([]);
    expect(parseAdReferrals(delivery({ id: '' }), WABA, now).referrals).toEqual([]);
  });
  it('a time in the future is a clock fault: the receipt time stands in; a long headline is cut', () => {
    expect(parseAdReferrals(delivery({ ts: 1_900_000_000 }), WABA, now).referrals[0].receivedAt).toEqual(now);
    expect(parseAdReferrals(delivery({ ts: 1_790_000_300 }), WABA, now).referrals[0].receivedAt).toEqual(new Date(1_790_000_300_000));   // inside five minutes: kept
    const long = parseAdReferrals(delivery({ referral: { ctwa_clid: CLID, headline: 'h'.repeat(900), source_url: `https://fb.me/${'u'.repeat(900)}` } }), WABA, now).referrals[0];
    expect(long.headline).toHaveLength(200);
    expect(long.sourceUrl).toHaveLength(500);
  });
});

describe('WhatsApp advert attribution: the rules', () => {
  it('the window is the owner\'s, 1 to 28 days, 7 when unset or nonsense', () => {
    expect([undefined, '', '7', '1', '28', '0', '29', '3.5', 'x', 14].map(ctwaWindowDays)).toEqual([7, 7, 7, 1, 28, 7, 7, 7, 7, 14]);
  });
  it('one sale, one claim: the later of the web click and the advert chat wins', () => {
    expect(metaClickTime('fb.1.1790000000000.IwAR2xQzAbCdEfGh')).toBe(1_790_000_000_000);
    expect(metaClickTime('fb.1.1790000000.IwAR2xQzAbCdEfGh')).toBe(1_790_000_000_000);       // a seconds timestamp is read as seconds
    expect(metaClickTime(undefined)).toBeNull();
    expect(metaClickTime('not-a-click')).toBeNull();
    const chat = new Date(1_790_000_500_000);
    expect(messagingClickWins(undefined, chat)).toBe(true);                                   // no web click at all
    expect(messagingClickWins('fb.1.1790000000000.IwAR2xQzAbCdEfGh', chat)).toBe(true);       // chat after the web click
    expect(messagingClickWins('fb.1.1790000900000.IwAR2xQzAbCdEfGh', chat)).toBe(false);      // web click after the chat
  });
  it('a sale against the advert is shaped as Meta documents business messaging', () => {
    expect(businessMessagingPurchase({ eventId: 'e-1', eventTimeSec: 1_790_000_600, valueUgx: 95000, orderNumber: 'GP-1001', wabaId: WABA, ctwaClid: CLID })).toEqual({
      event_name: 'Purchase', event_time: 1_790_000_600, event_id: 'e-1', action_source: 'business_messaging', messaging_channel: 'whatsapp',
      user_data: { whatsapp_business_account_id: WABA, ctwa_clid: CLID },
      custom_data: { currency: 'UGX', value: 95000, order_id: 'GP-1001' },
    });
    // No order number for a sale that has none; nothing but the two identifiers Meta asks for.
    const noOrder = businessMessagingPurchase({ eventId: 'e-2', eventTimeSec: 1, valueUgx: 1, wabaId: WABA, ctwaClid: CLID }) as any;
    expect(noOrder.custom_data).toEqual({ currency: 'UGX', value: 1 });
    expect(Object.keys(noOrder.user_data).sort()).toEqual(['ctwa_clid', 'whatsapp_business_account_id']);
  });
  it('the secrets are checked for shape when saved, and say what is wrong', () => {
    const ok = JSON.stringify({ appSecret: APP_SECRET, verifyToken: 'goldplus-webhook-verify-2026' });
    expect(ctwaSecretProblem(ok)).toBeNull();
    expect(parseCtwaSecrets(ok)).toEqual({ appSecret: APP_SECRET, verifyToken: 'goldplus-webhook-verify-2026', accessToken: null });
    expect(parseCtwaSecrets(JSON.stringify({ appSecret: APP_SECRET, verifyToken: 'goldplus-webhook-verify-2026', accessToken: 'EAAB' + 'x'.repeat(40) }))!.accessToken).toMatch(/^EAAB/);
    expect(ctwaSecretProblem('not json')).toMatch(/must be JSON/);
    expect(ctwaSecretProblem('[]')).toMatch(/JSON object/);
    expect(ctwaSecretProblem(JSON.stringify({ appSecret: 'short', verifyToken: 'goldplus-webhook-verify-2026' }))).toMatch(/App Secret/);
    expect(ctwaSecretProblem(JSON.stringify({ appSecret: APP_SECRET, verifyToken: 'short' }))).toMatch(/16 to 128 characters/);
    expect(ctwaSecretProblem(JSON.stringify({ appSecret: APP_SECRET, verifyToken: 'has a space in the middle' }))).toMatch(/no spaces/);
    expect(ctwaSecretProblem(JSON.stringify({ appSecret: APP_SECRET, verifyToken: 'goldplus-webhook-verify-2026', accessToken: 'x' }))).toMatch(/accessToken/);
    expect(parseCtwaSecrets('not json')).toBeNull();
    // The capability exists for Meta, needs the conversions destination, and validates its secret.
    const def = capabilityDef('meta', 'whatsapp_ads')!;
    expect(def).toMatchObject({ requiresDestination: true, secretLabel: 'Webhook secrets (JSON)' });
    expect(def.secretProblem!('nope')).toMatch(/must be JSON/);
    expect(def.fields.map((f) => [f.key, !!f.optional])).toEqual([['wabaId', false], ['windowDays', true], ['datasetId', true]]);
    expect(AD_CAPABILITIES.filter((c) => c.capability === 'whatsapp_ads').map((c) => c.platform)).toEqual(['meta']);
  });
});

describe('WhatsApp adverts: the use case', () => {
  const secrets = { appSecret: APP_SECRET, verifyToken: 'goldplus-webhook-verify-2026', accessToken: null };
  const settings = (over: Partial<CtwaSettings> = {}): CtwaSettings => ({ live: true, wabaId: WABA, windowDays: 7, datasetId: null, secrets, ...over });
  const store = () => {
    const rows: Array<StoredWhatsAppReferral & { sender: string; messageId: string; attributed: number }> = [];
    const repo: WhatsAppAdReferralRepository = {
      record: async (r) => { if (rows.some((x) => x.messageId === r.messageId)) return false; rows.push({ id: `ref-${rows.length + 1}`, ctwaClid: r.ctwaClid, wabaId: r.wabaId, sourceId: r.sourceId, receivedAt: r.receivedAt, sender: r.senderPhoneSha256, messageId: r.messageId, attributed: 0 }); return true; },
      latestFor: async (s, from, to) => rows.filter((x) => x.sender === s && x.receivedAt >= from && x.receivedAt <= to).sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())[0] ?? null,
      markAttributed: async (id) => { const r = rows.find((x) => x.id === id); if (r) r.attributed += 1; },
      stats: async () => ({ received: rows.length, attributed: rows.filter((x) => x.attributed > 0).length, lastReceivedAt: rows.length ? rows[rows.length - 1].receivedAt.toISOString() : null, adverts: new Set(rows.map((x) => x.sourceId)).size }),
    };
    return { rows, repo };
  };
  const at = new Date(1_790_000_100_000);
  const body = JSON.stringify(delivery());
  const phone = sha('256772123456');

  it('a delivery is stored only when Meta signed it; Meta\'s retry of the same message is not stored twice', async () => {
    const { rows, repo } = store();
    const uc = new WhatsAppAdsUseCases(repo, async () => settings(), () => at);
    expect(await uc.receive(body, 'sha256=' + 'a'.repeat(64))).toMatchObject({ status: 401, stored: 0 });
    expect(await uc.receive(body, undefined)).toMatchObject({ status: 401 });
    expect(rows).toHaveLength(0);
    expect(await uc.receive(body, sign(body, APP_SECRET))).toEqual({ status: 200, stored: 1, duplicates: 0, messages: 1, withoutClickId: 0 });
    expect(await uc.receive(body, sign(body, APP_SECRET))).toMatchObject({ status: 200, stored: 0, duplicates: 1 });
    expect(rows).toHaveLength(1);
    // Signed but not JSON, or signed and enormous: acknowledged or refused, never a crash.
    expect(await uc.receive('not json', sign('not json', APP_SECRET))).toMatchObject({ status: 200, stored: 0 });
    const huge = 'x'.repeat(1_000_001);
    expect(await uc.receive(huge, sign(huge, APP_SECRET))).toMatchObject({ status: 413 });
  });
  it('nothing configured is 404; configured but switched off acknowledges and keeps nothing', async () => {
    const a = store();
    expect(await new WhatsAppAdsUseCases(a.repo, async () => null, () => at).receive(body, sign(body, APP_SECRET))).toMatchObject({ status: 404 });
    expect(await new WhatsAppAdsUseCases(a.repo, async () => { throw new Error('vault key changed'); }, () => at).receive(body, sign(body, APP_SECRET))).toMatchObject({ status: 404 });
    const off = new WhatsAppAdsUseCases(a.repo, async () => settings({ live: false }), () => at);
    expect(await off.receive(body, sign(body, APP_SECRET))).toMatchObject({ status: 200, stored: 0, messages: 1 });
    expect(a.rows).toHaveLength(0);
    // Meta's subscription check works while it is off: verifying is part of setting it up.
    expect(await off.verifySubscription({ mode: 'subscribe', token: secrets.verifyToken, challenge: '42' })).toBe('42');
    expect(await off.verifySubscription({ mode: 'subscribe', token: 'wrong', challenge: '42' })).toBeNull();
    expect(await new WhatsAppAdsUseCases(a.repo, async () => null).verifySubscription({ mode: 'subscribe', token: secrets.verifyToken, challenge: '42' })).toBeNull();
  });
  it('credits a sale to the advert chat inside the window, to the latest chat, and never when a later web click exists', async () => {
    const { repo } = store();
    const uc = new WhatsAppAdsUseCases(repo, async () => settings({ windowDays: 7, datasetId: '9876543210123456' }), () => at);
    await uc.receive(body, sign(body, APP_SECRET));                                             // chat at 1_790_000_000
    const day = 86_400_000, chat = 1_790_000_000_000;
    const a = await uc.attributionFor(phone, new Date(chat + 2 * day));
    expect(a).toEqual({ referralId: 'ref-1', ctwaClid: CLID, wabaId: WABA, datasetId: '9876543210123456', accessToken: null });
    expect(await uc.attributionFor(phone, new Date(chat + 7 * day))).not.toBeNull();            // the last day of the window
    expect(await uc.attributionFor(phone, new Date(chat + 7 * day + 1000))).toBeNull();         // a second too late
    expect(await uc.attributionFor(phone, new Date(chat - 1000))).toBeNull();                   // a sale before the chat is not the chat's
    expect(await uc.attributionFor(sha('256700000001'), new Date(chat + day))).toBeNull();      // another buyer
    for (const bad of [null, undefined, '', 'not-a-hash']) expect(await uc.attributionFor(bad as never, new Date(chat + day))).toBeNull();
    // A Meta web click after the chat: the web advert has the later claim.
    expect(await uc.attributionFor(phone, new Date(chat + 2 * day), `fb.1.${chat + day}.IwAR2xQzAbCdEfGh`)).toBeNull();
    expect(await uc.attributionFor(phone, new Date(chat + 2 * day), `fb.1.${chat - day}.IwAR2xQzAbCdEfGh`)).not.toBeNull();
    // A second advert chat by the same number: the later one is used.
    const second = JSON.stringify(delivery({ id: 'wamid.SECOND', ts: 1_790_000_000 + 3600, referral: { ctwa_clid: `${CLID}2`, source_id: '555', source_type: 'ad' } }));
    await uc.receive(second, sign(second, APP_SECRET));
    expect((await uc.attributionFor(phone, new Date(chat + 2 * day)))!.ctwaClid).toBe(`${CLID}2`);
    // Switched off: nothing is credited, whatever is stored.
    expect(await new WhatsAppAdsUseCases(repo, async () => settings({ live: false }), () => at).attributionFor(phone, new Date(chat + day))).toBeNull();
  });
  it('the admin overview carries counts and the webhook address — no secret and no click id', async () => {
    const { repo } = store();
    const uc = new WhatsAppAdsUseCases(repo, async () => settings({ secrets: { ...secrets, accessToken: 'EAAB' + 'y'.repeat(40) } }), () => at);
    await uc.receive(body, sign(body, APP_SECRET));
    await uc.markAttributed('ref-1');
    const o = await uc.overview('https://api.shopgoldplus.com/webhooks/whatsapp');
    expect(o).toMatchObject({ configured: true, live: true, wabaId: WABA, windowDays: 7, ownDataset: false, ownToken: true, webhookUrl: 'https://api.shopgoldplus.com/webhooks/whatsapp',
      last30Days: { received: 1, attributed: 1, adverts: 1 } });
    const text = JSON.stringify(o);
    for (const secret of [APP_SECRET, secrets.verifyToken, 'EAABy', CLID]) expect(text).not.toContain(secret);
    expect(await new WhatsAppAdsUseCases(repo, async () => null, () => at).overview('u')).toMatchObject({ configured: false, live: false, wabaId: null, windowDays: 7 });
  });
});
