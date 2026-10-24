import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyChannel, CHANNELS } from '../../apps/api/src/domain/measurement/Channels';
import { declaredChannel, reportChannelForSpend, channelLabel, codeTouchFrom } from '../../apps/api/src/domain/measurement/ChannelReport';
import { HEARD_ABOUT_OPTIONS, HEARD_ABOUT_LABELS, parseHeardAbout } from '../../packages/shared/src/attribution/heardAbout';
import { youtubeVideoId, placementLink, placementChannel } from '../../apps/api/src/infrastructure/measurement/DrizzleMediaPlacementStore';

/**
 * Paid placements on YouTube channels (0206): the shop pays a channel for a video, not YouTube for ads. The money,
 * the arrivals through the description link and the customer's own answer must all land on the same channel.
 */
const executed: string[] = [];
let canned: Array<{ match: string; rows: any[] }> = [];
function sqlText(q: unknown): string {
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
vi.mock('../../apps/api/src/infrastructure/logging/logger', () => ({ logger: { warn: () => undefined, info: () => undefined, error: () => undefined } }));
const { YouTubeViewsPull } = await import('../../apps/api/src/infrastructure/measurement/YouTubeViewsPull');
const { MarketingCostDerivation } = await import('../../apps/api/src/infrastructure/measurement/MarketingCostDerivation');
const config = (values: Record<string, string>) => ({ values: async () => values, set: async () => ({ ok: true as const }), unset: async () => ({ ok: true as const, wasSet: false }) });

describe('YouTube is one channel for money, arrivals and the customer answer', () => {
  it('a visit from the description link or from youtube.com is the youtube channel, never organic or paid social', () => {
    expect(CHANNELS).toContain('youtube');
    expect(classifyChannel({ source: 'youtube', medium: 'sponsorship' })).toBe('youtube');
    expect(classifyChannel({ source: 'YouTube', medium: 'video' })).toBe('youtube');
    expect(classifyChannel({ source: 'youtube', medium: 'cpc' })).toBe('youtube'); // the shop runs no YouTube ads
    expect(classifyChannel({ referrerHost: 'www.youtube.com' })).toBe('youtube');
    expect(classifyChannel({ referrerHost: 'youtu.be' })).toBe('youtube');
    expect(classifyChannel({ referrerHost: 'm.youtube.com' })).toBe('youtube');
    expect(classifyChannel({ source: 'tiktok' })).toBe('organic_social'); // unchanged
  });

  it('the checkout offers "A YouTube video" and it is filed as youtube (customer said)', () => {
    expect(HEARD_ABOUT_OPTIONS.map((o) => o.value)).toContain('youtube');
    expect(HEARD_ABOUT_LABELS.youtube).toBe('A YouTube video');
    expect(parseHeardAbout('YouTube')).toBe('youtube');
    expect(declaredChannel('youtube')).toEqual({ channel: 'youtube', detail: 'customer said' });
    expect(channelLabel('youtube')).toBe('YouTube channels');
  });

  it('a promo code given to a channel files the order on that channel, named by outlet and title; other codes stay promo codes', () => {
    expect(codeTouchFrom({ code: 'TECHUG10', code_type: 'single', placement_detail: 'TechUganda: Power bank review', placement_medium: 'youtube' })).toEqual({ kind: 'youtube', detail: 'TechUganda: Power bank review' });
    expect(codeTouchFrom({ code: 'CBS5', placement_detail: 'CBS FM: Morning spot', placement_medium: 'radio' })).toEqual({ kind: 'offline_media', detail: 'CBS FM: Morning spot' });
    expect(codeTouchFrom({ code: 'save10' })).toEqual({ kind: 'promo_code', detail: 'SAVE10' });
    expect(codeTouchFrom({ code: 'X', creator_handle: 'amina', placement_detail: 'ignored' })).toEqual({ kind: 'creator', detail: 'amina' }); // a creator's own code is the creator
  });

  it('placement spend stays on youtube or offline media in the report', () => {
    expect(reportChannelForSpend('youtube', 'YouTube channel')).toBe('youtube');
    expect(reportChannelForSpend('offline_media', 'Radio')).toBe('offline_media');
    expect(placementChannel('youtube')).toBe('youtube');
    expect(placementChannel('radio')).toBe('offline_media');
  });

  it('reads a video id from every YouTube link shape and refuses anything else', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/@somechannel')).toBeNull();
    expect(youtubeVideoId('https://tiktok.com/@x/video/1')).toBeNull();
    expect(youtubeVideoId('')).toBeNull();
    expect(placementLink('youtube', 'techuganda-power-bank-ab12')).toBe('https://shopgoldplus.com/?utm_source=youtube&utm_medium=sponsorship&utm_campaign=techuganda-power-bank-ab12');
    expect(classifyChannel({ source: 'youtube', medium: 'sponsorship' })).toBe('youtube');
    expect(placementLink('radio', 'cbs-morning-x9')).toContain('utm_source=radio&utm_medium=placement');
  });
});

describe('placement money and views', () => {
  beforeEach(() => { executed.length = 0; canned = []; });

  it('the nightly spreads a placement over its flight days on the youtube channel, named by outlet and title', async () => {
    canned = [{ match: 'from media_placements p, generate_series', rows: [
      { day: '2026-10-20', medium: 'youtube', outlet: 'TechUganda', title: 'Power bank review', ugx: 250000 },
      { day: '2026-10-21', medium: 'youtube', outlet: 'TechUganda', title: 'Power bank review', ugx: 250000 },
      { day: '2026-10-21', medium: 'radio', outlet: 'CBS FM', title: 'Morning spot', ugx: 40000 },
    ] }];
    const r = await new MarketingCostDerivation(config({})).derive(35, new Date('2026-10-22T02:00:00Z'));
    const inserts = executed.filter((q) => q.includes('insert into media_cost_facts'));
    const yt = inserts.filter((q) => q.includes('TechUganda: Power bank review'));
    expect(yt).toHaveLength(2);
    expect(yt.every((q) => q.includes('youtube') && q.includes('YouTube channel') && q.includes('250000'))).toBe(true);
    const radio = inserts.find((q) => q.includes('CBS FM: Morning spot'));
    expect(radio).toContain('offline_media');
    expect(radio).toContain('Radio');
    expect(r.rows).toBe(3);
  });

  it('with no API key the views pull calls nothing and says it is not configured', async () => {
    canned = [{ match: 'from media_placements where medium', rows: [{ id: 'p1', video_id: 'dQw4w9WgXcQ' }] }];
    const fetchImpl = vi.fn();
    const r = await new YouTubeViewsPull(undefined, fetchImpl as unknown as typeof fetch).run(new Date('2026-10-24T01:00:00Z'));
    expect(r).toEqual({ configured: false, videos: 1, written: 0, missing: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(executed.filter((q) => q.includes('insert into media_placement_views'))).toHaveLength(0);
  });

  it('with a key it writes the cumulative count on the Kampala day and names videos the API did not return', async () => {
    canned = [{ match: 'from media_placements where medium', rows: [{ id: 'p1', video_id: 'dQw4w9WgXcQ' }, { id: 'p2', video_id: 'dQw4w9WgXcQ' }, { id: 'p3', video_id: 'gone0000000' }] }];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain('part=statistics');
      expect(String(url)).toContain('id=dQw4w9WgXcQ,gone0000000');
      expect(String(url)).not.toContain('key=undefined');
      return { ok: true, status: 200, json: async () => ({ items: [{ id: 'dQw4w9WgXcQ', statistics: { viewCount: '15320' } }] }) } as unknown as Response;
    });
    const r = await new YouTubeViewsPull('k', fetchImpl as unknown as typeof fetch).run(new Date('2026-10-23T22:30:00Z')); // 01:30 Kampala on the 24th
    expect(r).toEqual({ configured: true, videos: 2, written: 2, missing: ['gone0000000'] });
    const writes = executed.filter((q) => q.includes('insert into media_placement_views'));
    expect(writes).toHaveLength(2);
    expect(writes[0]).toContain('2026-10-24');
    expect(writes[0]).toContain('15320');
    expect(writes[0]).toContain('likes');
  });
});
