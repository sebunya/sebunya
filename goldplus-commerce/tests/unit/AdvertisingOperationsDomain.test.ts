import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  hashedContactFor, normaliseEmail, normaliseEmailGoogle, offlineSaleHashes, phoneDigitsE164, phoneSpellings,
} from '../../apps/api/src/domain/advertising/ContactNormalisation';
import { DEFAULT_SEGMENT_POLICY, groupBuyers, isQualifyingOrder, parseSegmentPolicy, selectSegment, type BuyerOrder } from '../../apps/api/src/domain/advertising/AudienceSegments';
import { channelForPlatform, currencyConflict, decimalToMinor, googleChannel, microsToMinor, parseCsv, parseSpendCsv, spendFactErrors } from '../../apps/api/src/domain/advertising/SpendFacts';
import { afterFailure, hasMatchKey, metaActionSource, offlineSaleErrors, onlinePurchaseCoversSale, withinSendWindow } from '../../apps/api/src/domain/advertising/OfflineConversionPolicy';
import { cleanSelection, eventSelected } from '../../apps/api/src/domain/advertising/OptimisationEvents';
import { hashEmail, hashPhone, hashPhonePlus } from '../../apps/api/src/infrastructure/advertising/AdPlatforms';
import { BrowserTelemetryEventSchema } from '../../packages/shared/src/events/telemetry';
import { isWhatsAppChatWithUs, leadAlreadySent } from '../../apps/web/src/lib/leadSignalRules';
import { kampalaClock } from '../../apps/api/src/infrastructure/scheduler/AdvertisingTicker';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

describe('contact normalisation per platform (before SHA-256)', () => {
  it('Ugandan numbers become E.164 digits; junk is not a number', () => {
    for (const p of ['0772 123 456', '+256 772 123456', '772123456', '00256772123456']) expect(phoneDigitsE164(p)).toBe('256772123456');
    expect(phoneDigitsE164('12')).toBeNull();
    expect(phoneDigitsE164(null)).toBeNull();
  });
  it('emails are trimmed and lower-cased; Google also drops gmail dots and +suffix', () => {
    expect(normaliseEmail('  Jane.Doe@Example.COM ')).toBe('jane.doe@example.com');
    expect(normaliseEmail('not-an-email')).toBeNull();
    expect(normaliseEmailGoogle('Jane.Doe+Shopping@googlemail.com')).toBe('janedoe@googlemail.com');
    expect(normaliseEmailGoogle('jane.doe+x@example.com')).toBe('jane.doe+x@example.com');
  });
  it('Google and TikTok hash the phone with "+", Meta without', () => {
    const c = { email: 'A@B.co', phone: '0772123456' };
    expect(hashedContactFor('google_ads', c).phone).toBe(sha('+256772123456'));
    expect(hashedContactFor('tiktok', c).phone).toBe(sha('+256772123456'));
    expect(hashedContactFor('meta', c).phone).toBe(sha('256772123456'));
    expect(hashedContactFor('meta', c).email).toBe(sha('a@b.co'));
  });
  it('agrees with the conversions builders (one normalisation, two call sites)', () => {
    expect(hashedContactFor('meta', { phone: '0772 123 456' }).phone).toBe(hashPhone('0772 123 456'));
    expect(hashedContactFor('tiktok', { phone: '0772 123 456' }).phone).toBe(hashPhonePlus('0772 123 456'));
    expect(hashedContactFor('meta', { email: ' Buyer@Example.com ' }).email).toBe(hashEmail(' Buyer@Example.com '));
  });
  it('an admin sale keeps every hash variant and no plaintext', () => {
    const h = offlineSaleHashes({ email: 'j.d@gmail.com', phone: '0772123456' });
    expect(h).toEqual({ emailSha256: sha('j.d@gmail.com'), emailGoogleSha256: sha('jd@gmail.com'), phoneDigitsSha256: sha('256772123456'), phonePlusSha256: sha('+256772123456') });
    expect(JSON.stringify(h)).not.toContain('0772123456');
    expect(phoneSpellings('0772123456')).toEqual(expect.arrayContaining(['256772123456', '+256772123456', '0772123456', '772123456']));
  });
});

const order = (o: Partial<BuyerOrder>): BuyerOrder => ({
  orderId: 'o1', userId: null, email: null, phone: null, fpClientId: null, totalUgx: 100_000, purchasedAt: new Date('2026-09-01T00:00:00Z'), status: 'delivered', paymentStatus: 'unpaid', ...o,
});

describe('audience segments from real orders', () => {
  it('only sales qualify: delivered/completed, or paid and not cancelled', () => {
    expect(isQualifyingOrder({ status: 'delivered', paymentStatus: 'unpaid' })).toBe(true);
    expect(isQualifyingOrder({ status: 'processing', paymentStatus: 'paid' })).toBe(true);
    expect(isQualifyingOrder({ status: 'received', paymentStatus: 'unpaid' })).toBe(false);
    expect(isQualifyingOrder({ status: 'cancelled', paymentStatus: 'paid' })).toBe(false);
  });
  it('orders sharing an account, email or phone are one person', () => {
    const buyers = groupBuyers([
      order({ orderId: 'a', phone: '0772123456', totalUgx: 100_000 }),
      order({ orderId: 'b', phone: '+256 772 123456', email: 'x@y.co', totalUgx: 50_000 }),
      order({ orderId: 'c', email: 'X@Y.co', userId: '11111111-1111-4111-8111-111111111111', totalUgx: 25_000 }),
      order({ orderId: 'd', phone: '0700000001' }),
      order({ orderId: 'e', phone: '0700000002', status: 'cancelled' }),
    ]);
    expect(buyers).toHaveLength(2);
    const big = buyers.find((b) => b.orderCount === 3)!;
    expect(big.lifetimeUgx).toBe(175_000);
    expect(big.userIds).toEqual(['11111111-1111-4111-8111-111111111111']);
  });
  it('recent buyers use the window; high value uses the threshold or the top share with ties kept', () => {
    const now = new Date('2026-09-25T00:00:00Z');
    const buyers = groupBuyers([
      order({ orderId: 'a', phone: '0700000001', purchasedAt: new Date('2026-09-20T00:00:00Z'), totalUgx: 500_000 }),
      order({ orderId: 'b', phone: '0700000002', purchasedAt: new Date('2026-06-01T00:00:00Z'), totalUgx: 500_000 }),
      order({ orderId: 'c', phone: '0700000003', purchasedAt: new Date('2026-06-01T00:00:00Z'), totalUgx: 90_000 }),
      order({ orderId: 'd', phone: '0700000004', purchasedAt: new Date('2026-06-01T00:00:00Z'), totalUgx: 80_000 }),
      order({ orderId: 'e', phone: '0700000005', purchasedAt: new Date('2026-06-01T00:00:00Z'), totalUgx: 70_000 }),
    ]);
    expect(selectSegment(buyers, 'recent_buyers', DEFAULT_SEGMENT_POLICY, now)).toHaveLength(1);
    // top 20% of 5 = 1, but the two 500k buyers tie: both are in.
    expect(selectSegment(buyers, 'high_value', DEFAULT_SEGMENT_POLICY, now)).toHaveLength(2);
    expect(selectSegment(buyers, 'high_value', { ...DEFAULT_SEGMENT_POLICY, highValueMinUgx: 85_000 }, now)).toHaveLength(3);
    expect(selectSegment(buyers, 'past_buyers', DEFAULT_SEGMENT_POLICY, now)).toHaveLength(5);
    expect(selectSegment([], 'high_value')).toEqual([]);
  });
  it('owner policy values are validated; unreadable falls back', () => {
    expect(parseSegmentPolicy({ recentDays: '14', highValueMinUgx: '300000' })).toMatchObject({ recentDays: 14, highValueMinUgx: 300000 });
    expect(parseSegmentPolicy({ recentDays: 'abc', highValueMinUgx: '-5' })).toMatchObject({ recentDays: 30, highValueMinUgx: null });
  });
});

describe('spend facts', () => {
  it('converts platform money without floating point', () => {
    expect(microsToMinor('1234560000', 'UGX')).toBe(1235);
    expect(microsToMinor('12345678', 'USD')).toBe(1235);
    expect(decimalToMinor('12.345', 'USD')).toBe(1235);
    expect(decimalToMinor('150,000', 'UGX')).toBe(150000);
    expect(decimalToMinor('-3', 'UGX')).toBeNull();
    expect(decimalToMinor('abc', 'UGX')).toBeNull();
  });
  it('parses quoted CSV cells', () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
  });
  it('a valid file becomes facts; campaign ids are the stable key', () => {
    const r = parseSpendCsv('date,platform,campaign,campaign_id,spend,currency,clicks,impressions\n2026-09-20,Opera Ads,"Chargers, Sept",77,85000,UGX,412,\n', new Date('2026-09-25T00:00:00Z'));
    expect(r.errors).toEqual([]);
    expect(r.facts[0]).toMatchObject({ campaign: 'id:77', campaignLabel: 'Chargers, Sept', spendMinor: 85000, clicks: 412, impressions: null, channel: 'paid_other', source: 'csv-upload' });
  });
  it('refuses a file with missing columns, bad rows, repeats or mixed currencies — nothing partial', () => {
    expect(parseSpendCsv('date,campaign\n2026-09-01,x\n').errors[0].errors[0]).toMatch(/missing column/);
    const bad = parseSpendCsv('date,platform,campaign,spend,currency\n2099-01-01,Meta,a,10,UGX\n2026-09-01,Meta,a,x,UGX\n', new Date('2026-09-25T00:00:00Z'));
    expect(bad.facts).toEqual([]);
    expect(bad.errors.map((e) => e.rowNumber)).toEqual([2, 3]);
    const dup = parseSpendCsv('date,platform,campaign,spend,currency\n2026-09-01,Meta,a,10,UGX\n2026-09-01,Meta,a,12,UGX\n', new Date('2026-09-25T00:00:00Z'));
    expect(dup.errors[0].errors[0]).toMatch(/already states/);
    const mixed = parseSpendCsv('date,platform,campaign,spend,currency\n2026-09-01,Meta,a,10,UGX\n2026-09-01,Meta,b,12,USD\n', new Date('2026-09-25T00:00:00Z'));
    expect(mixed.facts).toEqual([]);
    expect(mixed.errors[0].errors[0]).toMatch(/mixes/);
  });
  it('channels and currency conflicts', () => {
    expect(channelForPlatform('Meta')).toBe('paid_social');
    expect(channelForPlatform('Google Ads')).toBe('paid_search');
    expect(googleChannel('PERFORMANCE_MAX')).toBe('paid_pmax');
    const f = { spendDate: '2026-09-01', channel: 'paid_social', platform: 'Meta', account: 'a', campaign: 'c', campaignLabel: null, currency: 'USD', spendMinor: 1, clicks: null, impressions: null, source: 's' };
    expect(currencyConflict([f], ['UGX'])).toMatch(/already exists in UGX/);
    expect(currencyConflict([f], ['USD'])).toBeNull();
    expect(spendFactErrors({ ...f, clicks: -1 })).toContain('clicks must be a whole number (or left blank when unknown)');
  });
});

describe('offline conversion policy', () => {
  it('an online purchase that reached, or may still reach, the platform covers the sale', () => {
    for (const s of ['ACCEPTED', 'PROCESSED', 'PENDING', 'RETRY_WAIT', 'UNKNOWN_OUTCOME', 'LEASED', 'QUARANTINED']) expect(onlinePurchaseCoversSale(s)).toBe(true);
    for (const s of ['DEAD_LETTER', 'SUPPRESSED', 'CANCELLED', null]) expect(onlinePurchaseCoversSale(s)).toBe(false);
  });
  it('Meta action_source follows how the sale happened', () => {
    expect(metaActionSource('COD_DELIVERED', null)).toBe('physical_store');
    expect(metaActionSource('ADMIN_SALE', 'PHONE')).toBe('phone_call');
    expect(metaActionSource('ADMIN_SALE', 'WHATSAPP')).toBe('chat');
  });
  it('send windows: Meta/TikTok 7 days, Google 90', () => {
    const now = new Date('2026-09-25T00:00:00Z');
    const tenDays = new Date('2026-09-15T00:00:00Z');
    expect(withinSendWindow('meta', tenDays, now)).toBe(false);
    expect(withinSendWindow('google_ads', tenDays, now)).toBe(true);
    expect(withinSendWindow('meta', new Date('2026-09-30T00:00:00Z'), now)).toBe(false);
  });
  it('retries transient failures, stops on a permanent refusal or the budget', () => {
    expect(afterFailure(1, 500)).toMatchObject({ state: 'PENDING' });
    expect(afterFailure(1, 429)).toMatchObject({ state: 'PENDING' });
    expect(afterFailure(1, 400).state).toBe('FAILED');
    expect(afterFailure(5, 503).state).toBe('FAILED');
  });
  it('a sale needs a value, a time, a channel and something to match on', () => {
    const now = new Date('2026-09-25T12:00:00Z');
    expect(offlineSaleErrors({ channel: 'PHONE', occurredAt: '2026-09-25T09:00:00Z', valueUgx: 150000, phone: '0772123456' }, now)).toEqual([]);
    const e = offlineSaleErrors({ channel: 'SMS', occurredAt: '2027-01-01', valueUgx: 0 }, now);
    expect(e.join(' ')).toMatch(/phone or WhatsApp/);
    expect(e.join(' ')).toMatch(/future/);
    expect(e.join(' ')).toMatch(/whole UGX/);
    expect(e.join(' ')).toMatch(/no platform can match/);
  });
  it('each platform matches on its own click id or a hashed contact', () => {
    const none = { emailSha256: null, emailGoogleSha256: null, phoneDigitsSha256: null, phonePlusSha256: null };
    expect(hasMatchKey('google_ads', { clickIds: { gclid: 'g' }, hashes: none })).toBe(true);
    expect(hasMatchKey('meta', { clickIds: { gclid: 'g' }, hashes: none })).toBe(false);
    expect(hasMatchKey('tiktok', { clickIds: {}, hashes: { ...none, phonePlusSha256: 'h' } })).toBe(true);
  });
});

describe('early signals', () => {
  it('a null selection sends every supported event; purchases are never filtered', () => {
    expect(eventSelected(null, 'generate_lead')).toBe(true);
    expect(eventSelected(['add_to_cart'], 'begin_checkout')).toBe(false);
    expect(eventSelected([], 'purchase')).toBe(true);
    expect(cleanSelection(['add_to_cart', 'nonsense', 'generate_lead', 'add_to_cart'], ['add_to_cart', 'purchase'])).toEqual(['add_to_cart']);
    expect(cleanSelection('x', ['add_to_cart'])).toBeNull();
  });
  it('the browser may send generate_lead with its method, never a purchase', () => {
    const ok = BrowserTelemetryEventSchema.safeParse({ event_name: 'generate_lead', event_id: '11111111-1111-4111-8111-111111111111', event_time: 1790000000, source: 'browser', lead: { method: 'whatsapp' } });
    expect(ok.success).toBe(true);
    expect((ok as any).data.lead.method).toBe('whatsapp');
    expect(BrowserTelemetryEventSchema.safeParse({ event_name: 'generate_lead', event_id: '11111111-1111-4111-8111-111111111111', event_time: 1790000000, source: 'browser', lead: { method: 'sms' } }).success).toBe(false);
  });
  it('a WhatsApp chat with us is a lead; a share link is not; one lead per reference per device', () => {
    expect(isWhatsAppChatWithUs('https://wa.me/256700000000?text=hi')).toBe(true);
    expect(isWhatsAppChatWithUs('https://api.whatsapp.com/send?phone=256700000000&text=x')).toBe(true);
    expect(isWhatsAppChatWithUs('https://wa.me/?text=look')).toBe(false);
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(leadAlreadySent('Q-1', s)).toBe(false);
    expect(leadAlreadySent('Q-1', s)).toBe(true);
    expect(leadAlreadySent('Q-1', null)).toBe(false);
  });
});

describe('scheduler clock', () => {
  it('uses the Kampala day and hour (UTC+3)', () => {
    expect(kampalaClock(new Date('2026-09-24T23:30:00Z'))).toEqual({ day: '2026-09-25', hour: 2 });
    expect(kampalaClock(new Date('2026-09-25T00:30:00Z'))).toEqual({ day: '2026-09-25', hour: 3 });
  });
});

describe('migration 0154', () => {
  const dir = path.resolve(__dirname, '../../apps/api/src/infrastructure/db/migrations');
  it('is journalled right after 0153 and is additive only', () => {
    const journal = JSON.parse(fs.readFileSync(path.join(dir, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string; when: number }> };
    const i = journal.entries.findIndex((e) => e.tag === '0154_advertising_operations');
    expect(i).toBeGreaterThan(0);
    expect(journal.entries[i - 1].tag).toBe('0153_bulk_quote_lines');
    expect(journal.entries[i].idx).toBe(154);
    expect(journal.entries[i].when).toBeGreaterThan(journal.entries[i - 1].when);
    const sql = fs.readFileSync(path.join(dir, '0154_advertising_operations.sql'), 'utf8');
    const statements = sql.split('--> statement-breakpoint').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean);
    for (const st of statements) {
      expect(st).toMatch(/^(ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS|CREATE (UNIQUE )?INDEX IF NOT EXISTS|CREATE TABLE IF NOT EXISTS|DO \$\$ BEGIN\s+ALTER TABLE \w+ ADD CONSTRAINT)/);
      if (st.startsWith('ALTER TABLE') && /NOT NULL/.test(st)) expect(st).toMatch(/DEFAULT/);
    }
  });
});
