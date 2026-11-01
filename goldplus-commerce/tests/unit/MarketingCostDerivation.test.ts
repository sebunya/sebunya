import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The nightly cost derivation against a recording database fake: which rows it writes into media_cost_facts for
 * canned sends, points and creator payments, at the owner's rates (SMS 35 a part; WhatsApp from Meta's rate card
 * at the fed dollar rate plus the margin). The SQL text itself is not executed here; what is checked is the
 * arithmetic and the routing of each cost to a channel, platform and campaign.
 */
const executed: string[] = [];
let canned: Array<{ match: string; rows: any[] }> = [];
function sqlText(q: unknown): string {
  // drizzle sql`` chunks: StringChunk {value: string[]}, nested SQL {queryChunks}, or a bare parameter value.
  const chunks = (q as { queryChunks?: unknown[] })?.queryChunks ?? [];
  return chunks.map((c): string => {
    if (c === null || c === undefined) return 'null';
    if (typeof c !== 'object') return String(c);
    if (Array.isArray((c as { value?: unknown }).value)) return ((c as { value: string[] }).value).join('');
    if ((c as { queryChunks?: unknown[] }).queryChunks) return sqlText(c);
    return '';
  }).join('');
}
const answer = (q: unknown) => { const t = sqlText(q); executed.push(t); return canned.find((c) => t.includes(c.match))?.rows ?? []; };
vi.mock('../../apps/api/src/infrastructure/db/client', () => ({
  db: { execute: async (q: unknown) => answer(q), transaction: async (fn: (tx: unknown) => Promise<void>) => fn({ execute: async (q: unknown) => answer(q) }) },
}));

const { MarketingCostDerivation } = await import('../../apps/api/src/infrastructure/measurement/MarketingCostDerivation');

const config = (values: Record<string, string>) => ({ values: async () => values, set: async () => ({ ok: true as const }), unset: async () => ({ ok: true as const, wasSet: false }) });
const inserts = () => executed.filter((q) => q.includes('insert into media_cost_facts'));
const insertFor = (campaign: string) => inserts().filter((q) => q.includes(campaign));

describe('marketing cost derivation', () => {
  beforeEach(() => { executed.length = 0; canned = []; });

  it('bills SMS by parts at 35, WhatsApp by class from the rate card at the fed rate + margin, operational at utility', async () => {
    canned = [
      { match: 'from notification_attempts', rows: [
        { day: '2026-10-20', channel: 'sms', template: 'ORDER_DISPATCHED', n: 7 }, // 7 parts over several messages
        { day: '2026-10-20', channel: 'whatsapp', template: 'LOYALTY_MISSION_COMPLETE', n: 10 },
        { day: '2026-10-20', channel: 'whatsapp', template: 'ORDER_PAYMENT_SUCCESS', n: 4 },
        { day: '2026-10-20', channel: 'whatsapp', template: 'CARE_ALERT', n: 2 },
      ] },
      { match: 'from loyalty_config', rows: [{ point_value_ugx: 50 }] },
    ];
    const d = new MarketingCostDerivation(config({}), { latestFx: async () => ({ day: '2026-10-21', ugxPerUsd: 4126 }) });
    const r = await d.derive(35, new Date('2026-10-21T02:00:00Z'));
    expect(r.rates).toMatchObject({ ugxPerUsd: 4226, basis: 'feed', smsUgx: 35, whatsappMarketingUgx: 96, whatsappUtilityUgx: 17, whatsappBasis: 'rate_card' });
    expect(r.skipped).toEqual([]);
    expect(insertFor('transactional messages').find((q) => q.includes('EgoSMS'))).toContain('245'); // 7 × 35
    expect(insertFor('marketing messages').find((q) => q.includes('Meta WhatsApp'))).toContain('960'); // 10 × 96
    expect(insertFor('transactional messages').find((q) => q.includes('Meta WhatsApp'))).toContain('68'); // 4 × 17
    expect(insertFor('operational messages').find((q) => q.includes('Meta WhatsApp'))).toContain('34'); // 2 × 17, utility, never marketing
    expect(inserts().every((q) => q.includes("derived"))).toBe(true);
    expect(executed.find((q) => q.includes('delete from media_cost_facts'))).toContain('derived');
  });

  it('a hand-set dollar rate and a shilling WhatsApp override win over the feed and the card', async () => {
    canned = [{ match: 'from notification_attempts', rows: [{ day: '2026-10-20', channel: 'whatsapp', template: 'LOYALTY_MISSION_COMPLETE', n: 3 }] }];
    const d = new MarketingCostDerivation(config({ ugx_per_usd: '3900', whatsapp_cost_ugx_per_message: '80' }), { latestFx: async () => ({ day: '2026-10-21', ugxPerUsd: 4126 }) });
    const r = await d.derive(35, new Date('2026-10-21T02:00:00Z'));
    expect(r.rates).toMatchObject({ ugxPerUsd: 3900, basis: 'manual', whatsappMarketingUgx: 80, whatsappUtilityUgx: 80, whatsappBasis: 'override' });
    expect(insertFor('marketing messages')[0]).toContain('240');
    expect(r.skipped).toContain('loyalty point value is unset: referral and bonus points carry no cost');
  });

  it('spreads a negotiated creator payment over its days under the creator channel, named per creator', async () => {
    canned = [
      { match: 'from creator_negotiated_costs', rows: [
        { day: '2026-10-19', handle: 'amina', label: 'Two TikTok videos', ugx: 150000 },
        { day: '2026-10-20', handle: 'amina', label: 'Two TikTok videos', ugx: 150000 },
      ] },
      { match: 'from creator_contracts', rows: [{ day: '2026-10-20', ugx: 20000 }] },
    ];
    const d = new MarketingCostDerivation(config({}));
    const r = await d.derive(35, new Date('2026-10-21T02:00:00Z'));
    expect(r.rates.basis).toBe('default');
    expect(r.rates.ugxPerUsd).toBe(3800);
    const negotiated = inserts().filter((q) => q.includes('amina: Two TikTok videos'));
    expect(negotiated).toHaveLength(2);
    expect(negotiated.every((q) => q.includes('creator') && q.includes('150000'))).toBe(true);
    expect(insertFor('flat fees')).toHaveLength(1);
    expect(r.rows).toBe(3);
  });
});
