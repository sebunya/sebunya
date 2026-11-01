import { describe, expect, it } from 'vitest';
import { MEASUREMENT_CONFIG_REGISTRY, WHATSAPP_RATE_CARD, effectiveNumber, isMeasurementConfigKey, resolveUgxPerUsd, switchOn, validateMeasurementValue, whatsappCostUgx } from '../../apps/api/src/domain/measurement/MeasurementConfig';
import { HoldoutGate, phoneKey, type HoldoutStore } from '../../apps/api/src/application/use-cases/measurement/HoldoutGate';
import { reportChannelForSpend } from '../../apps/api/src/domain/measurement/ChannelReport';
import { mmmChannelKey } from '../../apps/api/src/infrastructure/measurement/MmmDataset';
import { storeZip } from '../../apps/api/src/infrastructure/measurement/storeZip';
import { calendarControls, inSchoolTerm, publicHolidays } from '../../apps/api/src/domain/measurement/UgandaCalendar';

describe('measurement config registry', () => {
  it('validates each type and rejects what it should', () => {
    expect(validateMeasurementValue('holdout_share_review_reminder', '0.2')).toEqual({ ok: true, value: 0.2 });
    expect(validateMeasurementValue('holdout_share_review_reminder', '0.9').ok).toBe(false);
    expect(validateMeasurementValue('holdout_share_review_reminder', 'abc').ok).toBe(false);
    expect(validateMeasurementValue('sms_cost_ugx_per_message', '35')).toEqual({ ok: true, value: 35 });
    expect(validateMeasurementValue('sms_cost_ugx_per_message', '-1').ok).toBe(false);
    expect(validateMeasurementValue('ugx_per_usd', '3700')).toEqual({ ok: true, value: 3700 });
    expect(validateMeasurementValue('ugx_per_usd', '5').ok).toBe(false);
    expect(validateMeasurementValue('ga4_assisted_orders', 'ON')).toEqual({ ok: true, value: 'on' });
    expect(validateMeasurementValue('ga4_assisted_orders', 'maybe').ok).toBe(false);
    expect(isMeasurementConfigKey('nope')).toBe(false);
  });
  it('defaults apply only when unset', () => {
    expect(effectiveNumber({}, 'ga4_reconciliation_tolerance_pct')).toBe(20);
    expect(effectiveNumber({ ga4_reconciliation_tolerance_pct: '5' }, 'ga4_reconciliation_tolerance_pct')).toBe(5);
    expect(effectiveNumber({}, 'sms_cost_ugx_per_message')).toBe(35); // owner's figure, 2026-10-23
    expect(effectiveNumber({}, 'ugx_per_usd')).toBe(3800);
    expect(effectiveNumber({}, 'whatsapp_cost_ugx_per_message')).toBeNull(); // the override stays off by default
    expect(switchOn({}, 'ga4_assisted_orders')).toBe(false);
    expect(switchOn({ ga4_assisted_orders: 'on' }, 'ga4_assisted_orders')).toBe(true);
    expect(MEASUREMENT_CONFIG_REGISTRY.every((e) => e.key && e.label && e.help)).toBe(true);
  });
});

function fakeStore(): HoldoutStore & { rows: any[] } {
  const rows: any[] = [];
  return { rows, salt: async () => 'salt-1', recordAssignment: async (row) => { rows.push(row); return row.arm; } };
}
const config = (values: Record<string, string>) => ({ values: async () => values, set: async () => ({ ok: true as const }), unset: async () => ({ ok: true as const, wasSet: false }) });

describe('holdout gate', () => {
  it('holds the configured share, deterministically per customer and wave', async () => {
    const store = fakeStore();
    const gate = new HoldoutGate(config({ holdout_share_review_reminder: '0.2' }) as any, store);
    const at = new Date('2026-10-23T10:00:00Z');
    const arms = await Promise.all(Array.from({ length: 400 }, (_, i) => gate.decide({ programme: 'review_reminder', subjectRef: `order-${i}`, phone: `07${String(10000000 + i)}`, at })));
    const held = arms.filter((a) => a === 'hold').length;
    expect(held).toBeGreaterThan(50); expect(held).toBeLessThan(110);
    expect(store.rows).toHaveLength(400);
    const again = await gate.decide({ programme: 'review_reminder', subjectRef: 'order-x', phone: '0710000007', at });
    expect(again).toBe(arms[7]); // same customer, same wave → same arm, whatever the order
  });
  it('treats everyone when the share is zero or unset, and never throws', async () => {
    const store = fakeStore();
    const gate = new HoldoutGate(config({}) as any, store);
    expect(await gate.decide({ programme: 'loyalty_expiry', subjectRef: 'a', userId: 'u1' })).toBe('treat');
    const broken = new HoldoutGate({ values: async () => { throw new Error('db down'); } } as any, store);
    expect(await broken.decide({ programme: 'review_reminder', subjectRef: 'b', userId: 'u2' })).toBe('treat');
  });
  it('keys phones by their digits so 0700 and +256700 are one person', () => {
    expect(phoneKey('0700 123 456')).toBe(phoneKey('+256700123456'));
    expect(phoneKey('0700123456')).not.toBe(phoneKey('0700123457'));
  });
});

describe('spend channels', () => {
  it('maps derived owned-channel costs onto the report channels', () => {
    expect(reportChannelForSpend('sms', 'EgoSMS')).toBe('sms');
    expect(reportChannelForSpend('whatsapp', 'Meta WhatsApp')).toBe('whatsapp');
    expect(reportChannelForSpend('loyalty', 'loyalty')).toBe('loyalty');
    expect(reportChannelForSpend('friend_referral', 'loyalty')).toBe('friend_referral');
    expect(reportChannelForSpend('creator', 'creators')).toBe('creator');
    expect(reportChannelForSpend('paid_social', 'Meta')).toBe('paid_social');
  });
  it('keeps paid platforms apart for the model', () => {
    expect(mmmChannelKey('paid_social', 'Meta Ads')).toBe('meta');
    expect(mmmChannelKey('paid_search', 'Google Ads')).toBe('google_ads');
    expect(mmmChannelKey('whatsapp', 'Meta WhatsApp')).toBe('whatsapp');
    expect(mmmChannelKey('sms', 'EgoSMS')).toBe('sms');
  });
});

describe('store zip', () => {
  it('writes a readable archive with both files', () => {
    const zip = storeZip([{ name: 'daily.csv', content: 'a,b\n1,2\n' }, { name: 'controls.csv', content: 'date,key,value\n' }], new Date('2026-10-23T00:00:00Z'));
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(2);
    expect(zip.toString('latin1')).toContain('daily.csv');
  });
});

describe('Uganda calendar', () => {
  it('knows fixed and moving holidays and school terms', () => {
    const h = publicHolidays(2026);
    expect(h.get('2026-10-09')).toBe('Independence Day');
    expect([...h.keys()].some((d) => d.startsWith('2026-04'))).toBe(true); // Easter
    expect(inSchoolTerm('2026-03-10')).toBe(true);
    expect(inSchoolTerm('2026-01-10')).toBe(false);
    expect(calendarControls('2026-10-09').holiday).toBe(1);
    expect(calendarControls('2026-10-23').holiday).toBe(0);
  });
});

describe('shillings per dollar and WhatsApp message cost (owner rules 2026-10-23)', () => {
  const today = '2026-10-23';
  it('a hand-set rate wins over the feed', () => {
    expect(resolveUgxPerUsd({ ugx_per_usd: '3900' }, { day: today, ugxPerUsd: 4126 }, today)).toMatchObject({ rate: 3900, basis: 'manual' });
  });
  it('the fed market rate plus the 100-shilling margin is used when fresh', () => {
    expect(resolveUgxPerUsd({}, { day: '2026-10-22', ugxPerUsd: 4126.43 }, today)).toMatchObject({ rate: 4226, basis: 'feed' });
    expect(resolveUgxPerUsd({ usd_ugx_margin: '250' }, { day: today, ugxPerUsd: 4000 }, today)).toMatchObject({ rate: 4250, basis: 'feed' });
  });
  it('falls back to 3,800 with no feed, or a stale one', () => {
    expect(resolveUgxPerUsd({}, null, today)).toMatchObject({ rate: 3800, basis: 'default' });
    expect(resolveUgxPerUsd({}, { day: '2026-10-01', ugxPerUsd: 4126 }, today)).toMatchObject({ rate: 3800, basis: 'default' });
    expect(resolveUgxPerUsd({}, { day: '2026-10-16', ugxPerUsd: 4126 }, today).basis).toBe('feed'); // exactly 7 days still counts
  });
  it("WhatsApp costs come from Meta's Rest-of-Africa card at the resolved rate, rounded up, unless overridden", () => {
    expect(WHATSAPP_RATE_CARD).toMatchObject({ marketingUsd: 0.0225, utilityUsd: 0.004, effective: '2025-10-01' });
    expect(whatsappCostUgx({}, 3800)).toEqual({ marketing: 86, utility: 16, basis: 'rate_card' });
    expect(whatsappCostUgx({}, 4226)).toEqual({ marketing: 96, utility: 17, basis: 'rate_card' });
    expect(whatsappCostUgx({ whatsapp_marketing_usd_per_message: '0.03' }, 4000)).toEqual({ marketing: 120, utility: 16, basis: 'rate_card' });
    expect(whatsappCostUgx({ whatsapp_cost_ugx_per_message: '90' }, 4226)).toEqual({ marketing: 90, utility: 90, basis: 'override' });
  });
  it('dollar rates take four decimals at most and must be registry keys', () => {
    expect(validateMeasurementValue('whatsapp_marketing_usd_per_message', '0.0225')).toEqual({ ok: true, value: 0.0225 });
    expect(validateMeasurementValue('whatsapp_marketing_usd_per_message', '0.00225').ok).toBe(false);
    expect(validateMeasurementValue('whatsapp_utility_usd_per_message', '2').ok).toBe(false);
    expect(validateMeasurementValue('usd_ugx_margin', '100')).toEqual({ ok: true, value: 100 });
    expect(isMeasurementConfigKey('usd_ugx_margin')).toBe(true);
  });
});
