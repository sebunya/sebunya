import { describe, expect, it } from 'vitest';
import { withVisitorClickIds, CLICK_ID_MAX_AGE_MS } from '../../apps/api/src/infrastructure/advertising/VisitorClickIds';

/**
 * Browsing events carry only the visitor id; the click id lives in the identity
 * graph. Without this merge, X's default scope ("visitors who arrived on an X
 * click") could never see a basket add or a product view (2026-10-01).
 */
const base = { event_name: 'add_to_cart', event_id: 'e1', event_time: 1_700_000_000, source: 'server',
  user_data: { fp_client_id: 'fp.1.abc', ip_address: '41.84.203.125', user_agent: 'UA' } } as never;
const now = 1_800_000_000_000;
const fresh = new Date(now - 60_000);

describe('withVisitorClickIds', () => {
  it('merges the stitched click ids onto a browsing event, leaving everything else as it was', async () => {
    const out = await withVisitorClickIds(base, async (fp) => (fp === 'fp.1.abc' ? { twclid: 'tw123', gclid: 'Cj0K', fbp: 'fb.1.2.3', updatedAt: fresh } : null), now);
    expect(out.user_data).toEqual({ fp_client_id: 'fp.1.abc', ip_address: '41.84.203.125', user_agent: 'UA', twclid: 'tw123', gclid: 'Cj0K', fbp: 'fb.1.2.3' });
    expect(out.event_name).toBe('add_to_cart');
    // The input is not mutated: the queued row stays free of click ids.
    expect((base as any).user_data.twclid).toBeUndefined();
  });
  it('never overrides a click id the event already names', async () => {
    const ev = { ...base, user_data: { ...(base as any).user_data, twclid: 'from-the-order' } } as never;
    const out = await withVisitorClickIds(ev, async () => ({ twclid: 'from-the-graph', updatedAt: fresh }), now);
    expect(out).toBe(ev);
  });
  it('ignores a record older than the networks\' attribution windows', async () => {
    const stale = new Date(now - CLICK_ID_MAX_AGE_MS - 1);
    expect(await withVisitorClickIds(base, async () => ({ twclid: 'tw-old', updatedAt: stale }), now)).toBe(base);
    const edge = new Date(now - CLICK_ID_MAX_AGE_MS);
    expect((await withVisitorClickIds(base, async () => ({ twclid: 'tw-edge', updatedAt: edge }), now)).user_data).toMatchObject({ twclid: 'tw-edge' });
  });
  it('leaves the event alone when there is no visitor id, no record, no click, or the lookup fails', async () => {
    expect(await withVisitorClickIds({ ...base, user_data: {} } as never, async () => ({ twclid: 'x', updatedAt: fresh }), now)).toMatchObject({ user_data: {} });
    expect(await withVisitorClickIds(base, async () => null, now)).toBe(base);
    expect(await withVisitorClickIds(base, async () => ({ hashed_email: 'h', updatedAt: fresh } as never), now)).toBe(base);
    expect(await withVisitorClickIds(base, async () => ({ twclid: '', updatedAt: fresh }), now)).toBe(base);
    expect(await withVisitorClickIds(base, async () => { throw new Error('graph down'); }, now)).toBe(base);
  });
  it('uses when the click id last CHANGED, not when the row was last touched', async () => {
    const stale = new Date(now - CLICK_ID_MAX_AGE_MS - 1);
    // Touched a minute ago (a sign-in), but the click itself is older than the window: not merged.
    expect(await withVisitorClickIds(base, async () => ({ twclid: 'tw-old', updatedAt: fresh, clickIdsAt: stale }), now)).toBe(base);
    // A row from before the column existed falls back to its last touch.
    expect((await withVisitorClickIds(base, async () => ({ twclid: 'tw1', updatedAt: fresh, clickIdsAt: null }), now)).user_data).toMatchObject({ twclid: 'tw1' });
    expect((await withVisitorClickIds(base, async () => ({ twclid: 'tw2', updatedAt: stale, clickIdsAt: fresh }), now)).user_data).toMatchObject({ twclid: 'tw2' });
  });
  it('gives every event from a real visitor id a Meta browser id, derived and stable, with or without a click', async () => {
    const fp = 'fp.1790841536221.fa7903b5-a629-4083-9121-715539a7c550';
    const ev = { ...(base as any), user_data: { fp_client_id: fp, ip_address: '41.84.203.125', user_agent: 'UA' } } as never;
    const noClick = await withVisitorClickIds(ev, async () => null, now);
    expect((noClick.user_data as any).fbp).toMatch(/^fb\.1\.1790841536221\.[1-9]\d{9}$/);
    const withClick = await withVisitorClickIds(ev, async () => ({ fbc: 'fb.1.1790841536999.IwAR2xQzAbCdEfGh', updatedAt: fresh, clickIdsAt: fresh }), now);
    expect(withClick.user_data).toMatchObject({ fbc: 'fb.1.1790841536999.IwAR2xQzAbCdEfGh', fbp: (noClick.user_data as any).fbp });
    // Even when the graph cannot be read, the browser id needs no lookup.
    expect(((await withVisitorClickIds(ev, async () => { throw new Error('graph down'); }, now)).user_data as any).fbp).toBe((noClick.user_data as any).fbp);
    // An event that already carries one keeps it; the queued event is never mutated.
    const own = { ...(ev as any), user_data: { ...(ev as any).user_data, fbp: 'fb.1.1700000000000.1234567890' } } as never;
    expect(((await withVisitorClickIds(own, async () => null, now)).user_data as any).fbp).toBe('fb.1.1700000000000.1234567890');
    expect((ev as any).user_data.fbp).toBeUndefined();
  });
  it('merges click ids only — a hashed contact in the graph is not copied onto a browsing event', async () => {
    const out = await withVisitorClickIds(base, async () => ({ twclid: 'tw1', hashedEmail: 'a'.repeat(64), hashedPhone: 'b'.repeat(64), updatedAt: fresh } as never), now);
    expect(Object.keys(out.user_data as object).sort()).toEqual(['fp_client_id', 'ip_address', 'twclid', 'user_agent']);
  });
});
