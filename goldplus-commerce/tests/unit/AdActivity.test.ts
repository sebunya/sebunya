import { describe, expect, it } from 'vitest';
import {
  activityWindow, daysOfWindow, explainOutcome, isOutOfScope, outcomeOfIntentState, outcomeOfQueueStatus, topReason, PLATFORM_CLICK,
} from '../../apps/api/src/domain/advertising/AdActivity';
import { AdActivityUseCases, type ActivityPlatform } from '../../apps/api/src/application/use-cases/advertising/AdActivityUseCases';
import type { AdActivityRepository } from '../../apps/api/src/application/ports/AdActivity';

/**
 * The activity page answers "is anything reaching the platform, and if not,
 * where does it stop?" These tests pin the two things it must never get wrong:
 * which outcome a stored state is, and the sentence shown for it.
 */
describe('ad activity: outcomes and sentences', () => {
  it('maps every stored queue status and intent state to one of four outcomes', () => {
    expect(['sent', 'skipped', 'suppressed', 'withdrawn', 'dead_letter', 'retrying', 'pending', 'processing', undefined].map(outcomeOfQueueStatus))
      .toEqual(['sent', 'not_sent', 'not_sent', 'not_sent', 'failed', 'waiting', 'waiting', 'waiting', 'waiting']);
    expect(['ACCEPTED', 'PROCESSED', 'SUPPRESSED', 'CANCELLED', 'PENDING', 'LEASED', 'RETRY_WAIT', 'UNKNOWN_OUTCOME', 'QUARANTINED', 'DEAD_LETTER', 'SOMETHING_NEW'].map(outcomeOfIntentState))
      .toEqual(['sent', 'sent', 'not_sent', 'not_sent', 'waiting', 'waiting', 'waiting', 'waiting', 'failed', 'failed', 'failed']);
  });

  const x = { platformName: 'X (Twitter) Ads' };
  it('says why an event was not sent, in the owner\'s terms — one sentence per stored reason', () => {
    expect(explainOutcome({ ...x, outcome: 'not_sent', raw: 'NO_X_CLICK' })).toMatch(/did not arrive from an X ad.*x_clicks/);
    expect(explainOutcome({ platformName: 'Meta', outcome: 'not_sent', raw: 'NO_BROWSER' })).toMatch(/requires the page and the browser/);
    expect(explainOutcome({ ...x, outcome: 'not_sent', raw: 'NO_EVENT_ID' })).toMatch(/No event ID is saved.*Advertising page/);
    expect(explainOutcome({ ...x, outcome: 'not_sent', raw: 'NO_IDENTIFIER' })).toMatch(/Nothing X \(Twitter\) Ads can match on/);
    expect(explainOutcome({ platformName: 'Meta', outcome: 'not_sent', raw: 'IDENTITY_UNAVAILABLE' })).toMatch(/Nothing Meta can match on/);
    expect(explainOutcome({ ...x, outcome: 'not_sent', raw: 'CONSENT_DENIED' })).toMatch(/refused advertising/);
    expect(explainOutcome({ ...x, outcome: 'not_sent', raw: 'platform switched off' })).toMatch(/switched off before/);
    expect(explainOutcome({ ...x, outcome: 'not_sent', raw: 'token could not be decrypted' })).toMatch(/Re-enter them/);
    expect(explainOutcome({ ...x, outcome: 'not_sent', raw: 'ORDER_CANCELLED' })).toMatch(/cancelled before/);
    // A row recorded before the reasons were split could have been any of three things: the sentence says so, and does not pick one.
    const legacy = explainOutcome({ ...x, outcome: 'not_sent', raw: 'no equivalent event or required identifier' });
    expect(legacy).toMatch(/no event ID for it, or nothing to match/);
    expect(legacy).not.toMatch(/did not arrive/);
  });
  it('only "the visitor did not come from our ad" is out of scope; every other reason stays on the page', () => {
    expect(isOutOfScope('NO_X_CLICK')).toBe(true);
    for (const r of ['NO_EVENT_ID', 'NO_IDENTIFIER', 'CONSENT_DENIED', 'no equivalent event or required identifier', 'x HTTP 403: nope', '', null, undefined]) expect(isOutOfScope(r), String(r)).toBe(false);
  });
  it('names an access refusal for what it is, and never hides the platform\'s own answer', () => {
    const s = explainOutcome({ ...x, outcome: 'failed', raw: 'x HTTP 403: {"errors":[{"code":"UNAUTHORIZED_CLIENT_APPLICATION"}]}' });
    expect(s).toMatch(/refused the request \(403\)/);
    expect(s).toMatch(/API access is not approved/);
    expect(s).toContain('UNAUTHORIZED_CLIENT_APPLICATION');
    expect(explainOutcome({ ...x, outcome: 'failed', raw: 'x HTTP 400: bad event_id' })).toMatch(/refused this event \(400\).*bad event_id/);
    expect(explainOutcome({ ...x, outcome: 'failed', raw: 'x HTTP 503: unavailable' })).toMatch(/Gave up after repeated failures.*503/);
    expect(explainOutcome({ ...x, outcome: 'waiting', raw: null })).toMatch(/Queued/);
    expect(explainOutcome({ ...x, outcome: 'sent', raw: 'ignored' })).toBe('Sent to X (Twitter) Ads.');
    // A stored reason nobody has named yet is shown as stored, not replaced with a guess.
    expect(explainOutcome({ ...x, outcome: 'not_sent', raw: 'A_NEW_REASON' })).toBe('Not sent: A_NEW_REASON');
  });
  it('clamps the window to the offered periods and lists every day in it, oldest first', () => {
    expect([7, '30', 90, 14, 'x', undefined].map(activityWindow)).toEqual([7, 30, 90, 30, 30, 30]);
    expect(daysOfWindow('2026-10-01', 3)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
    expect(daysOfWindow('2026-03-01', 2)).toEqual(['2026-02-28', '2026-03-01']);
  });
  it('finds the commonest stored reason', () => {
    expect(topReason([])).toBeNull();
    const c = (reason: string | null, n: number) => ({ day: 'd', event: 'e', outcome: 'not_sent' as const, reason, n, lastAt: null });
    expect(topReason([c('A', 2), c('B', 5), c('A', 4)])).toEqual({ reason: 'A', n: 6 });
  });
  it('X is recognised by twclid; a platform with no stitched click id says so', () => {
    expect(PLATFORM_CLICK.x).toEqual({ param: 'twclid', column: 'twclid' });
    expect(PLATFORM_CLICK.snapchat.column).toBeNull();
  });
});

describe('ad activity: the view', () => {
  const platformX = (over: Partial<ActivityPlatform['row']> = {}, state = 'LIVE'): ActivityPlatform => ({
    key: 'x', name: 'X (Twitter) Ads', state,
    events: { view_item: 'Content view (custom)', add_to_cart: 'Add to cart', begin_checkout: 'Checkout initiated (custom)', add_payment_info: 'Added payment info', generate_lead: 'Lead', purchase: 'Purchase' },
    row: { enabled: true, config: { pixelId: 'rg6ox', purchaseEventId: 'tw-rg6ox-rg6pz', addToCartEventId: 'tw-rg6ox-rg7rh' }, eventSelection: ['add_to_cart'], lastSuccessAt: null, lastError: null, lastErrorAt: null, ...over },
  });
  const meta: ActivityPlatform = { key: 'meta', name: 'Meta', state: 'NOT_CONFIGURED', events: { purchase: 'Purchase' }, row: null };
  const repo = (over: Partial<AdActivityRepository> = {}): AdActivityRepository => ({
    today: async () => '2026-10-01', counts: async () => [], recent: async () => [], arrivals: async () => [], recognised: async () => 0, ...over,
  });
  const FIELD: Record<string, string> = { purchase: 'purchaseEventId', add_to_cart: 'addToCartEventId', view_item: 'contentViewEventId' };
  const eventIdOf = (p: string, cfg: Record<string, string>, e: string) => (p === 'x' ? (cfg[FIELD[e] ?? ''] || null) : undefined);

  it('an empty period is all zeros, every day present, and no invented reason', async () => {
    const v = (await new AdActivityUseCases(repo(), async () => [meta, platformX()], eventIdOf).view('x', 7))!;
    expect(v.platform).toBe('x');
    expect(v.scope).toBe('x_clicks');
    expect(v.daily).toHaveLength(7);
    expect(v.daily[0].day).toBe('2026-09-25');
    expect(v.funnel).toMatchObject({ clickParam: 'twclid', arrivals: 0, recognised: 0, raised: 0, sent: 0, not_sent: 0, failed: 0, waiting: 0 });
    expect(v.events.every((e) => e.mainReason === null)).toBe(true);
    expect(v.recent).toEqual([]);
  });

  it('folds counts into the funnel, the per-event rows and the days, and explains the main reason', async () => {
    const v = (await new AdActivityUseCases(repo({
      counts: async (platform, since) => {
        expect(platform).toBe('x'); expect(since).toBe('2026-09-25');
        return [
          { day: '2026-09-30', event: 'add_to_cart', outcome: 'sent', reason: null, n: 3, lastAt: '2026-09-30T10:00:00.000Z' },
          { day: '2026-10-01', event: 'add_to_cart', outcome: 'sent', reason: null, n: 1, lastAt: '2026-10-01T08:00:00.000Z' },
          { day: '2026-10-01', event: 'add_to_cart', outcome: 'not_sent', reason: 'NO_IDENTIFIER', n: 9, lastAt: null },
          { day: '2026-10-01', event: 'add_to_cart', outcome: 'not_sent', reason: 'CONSENT_DENIED', n: 2, lastAt: null },
          // Most of the shop's traffic: visitors who never saw an X ad. Reported once, counted nowhere else.
          { day: '2026-10-01', event: 'add_to_cart', outcome: 'not_sent', reason: 'NO_X_CLICK', n: 400, lastAt: null },
          { day: '2026-09-30', event: 'purchase', outcome: 'not_sent', reason: 'NO_X_CLICK', n: 7, lastAt: null },
          { day: '2026-10-01', event: 'purchase', outcome: 'failed', reason: 'x HTTP 403: nope', n: 1, lastAt: null },
        ];
      },
      arrivals: async (param) => { expect(param).toBe('twclid'); return [{ day: '2026-09-30', n: 4 }, { day: '2026-10-01', n: 2 }]; },
      recognised: async (col) => { expect(col).toBe('twclid'); return 5; },
      recent: async (_p, _since, limit, includeOutOfScope) => {
        expect(limit).toBe(50); expect(includeOutOfScope).toBe(false);
        return [{ at: '2026-10-01T08:00:00.000Z', event: 'add_to_cart', path: 'browse', outcome: 'sent', reason: null, attempts: 1, value: 45000, currency: 'UGX' }];
      },
    }), async () => [platformX()], eventIdOf).view('x', 7))!;

    expect(v.outOfScope).toBe(407);
    expect(v.showingOutOfScope).toBe(false);

    expect(v.funnel).toMatchObject({ arrivals: 6, recognised: 5, raised: 16, sent: 4, not_sent: 11, failed: 1, waiting: 0 });
    const cart = v.events.find((e) => e.event === 'add_to_cart')!;
    expect(cart).toMatchObject({ label: 'Add to cart', eventId: 'tw-rg6ox-rg7rh', configured: true, selected: true, sent: 4, not_sent: 11, failed: 0, lastSentAt: '2026-10-01T08:00:00.000Z' });
    expect(cart.mainReason).toMatchObject({ n: 9 });
    expect(cart.mainReason!.text).toMatch(/Nothing X Ads can match on/);
    const purchase = v.events.find((e) => e.event === 'purchase')!;
    expect(purchase).toMatchObject({ failed: 1, selected: true });           // purchases are never switched off
    expect(purchase.mainReason!.text).toMatch(/refused the request \(403\)/);
    // An event with no ID saved, and one not ticked, say so rather than showing a silent zero.
    expect(v.events.find((e) => e.event === 'begin_checkout')).toMatchObject({ mapped: true, configured: false });
    expect(v.events.find((e) => e.event === 'view_item')).toMatchObject({ configured: false, selected: false });
    // The table reads as a journey.
    expect(v.events.map((e) => e.event)).toEqual(['view_item', 'add_to_cart', 'begin_checkout', 'add_payment_info', 'generate_lead', 'purchase']);
    expect(v.daily.find((d) => d.day === '2026-10-01')).toMatchObject({ sent: 1, not_sent: 11, failed: 1, arrivals: 2 });
    expect(v.daily.find((d) => d.day === '2026-09-30')).toMatchObject({ sent: 3, arrivals: 4 });
    expect(v.recent[0]).toMatchObject({ label: 'Add to cart', explanation: 'Sent to X Ads.' });   // the title's parenthesis is dropped in a sentence
  });

  it('"include everything" widens only the list: the repository is asked for it, the numbers do not move', async () => {
    let asked: boolean | null = null;
    const r = repo({
      counts: async () => [
        { day: '2026-10-01', event: 'add_to_cart', outcome: 'sent', reason: null, n: 2, lastAt: null },
        { day: '2026-10-01', event: 'add_to_cart', outcome: 'not_sent', reason: 'NO_X_CLICK', n: 90, lastAt: null },
      ],
      recent: async (_p, _s, _l, all) => { asked = all; return []; },
    });
    const uc = new AdActivityUseCases(r, async () => [platformX()], eventIdOf);
    const wide = (await uc.view('x', 7, true))!;
    expect(asked).toBe(true);
    expect(wide.showingOutOfScope).toBe(true);
    expect(wide.funnel).toMatchObject({ raised: 2, sent: 2, not_sent: 0 });
    expect(wide.outOfScope).toBe(90);
    expect(wide.daily.find((d) => d.day === '2026-10-01')).toMatchObject({ sent: 2, not_sent: 0 });
  });

  it('defaults to a live platform, falls back to X, and reports the "all" scope', async () => {
    const uc = new AdActivityUseCases(repo(), async () => [meta, platformX({ config: { sendScope: 'all' } })], eventIdOf);
    expect((await uc.view('nonsense', 30))!.platform).toBe('x');       // the live one
    expect((await uc.view(undefined, 30))!.scope).toBe('all');
    const off = new AdActivityUseCases(repo(), async () => [meta, platformX({}, 'READY_OFF')], eventIdOf);
    expect((await off.view(undefined, 30))!.platform).toBe('x');
    expect((await uc.view('meta', 30))!).toMatchObject({ platform: 'meta', scope: null });
    expect(await new AdActivityUseCases(repo(), async () => []).view('x', 30)).toBeNull();
  });

  it('a platform with no per-event ID treats every mapped event as configured', async () => {
    const v = (await new AdActivityUseCases(repo(), async () => [{ ...meta, state: 'LIVE', row: { enabled: true, config: {} } }], eventIdOf).view('meta', 30))!;
    expect(v.events).toEqual([expect.objectContaining({ event: 'purchase', configured: true, eventId: null })]);
    // Meta's click is recognised through the _fbc cookie column.
    expect(v.funnel.clickParam).toBe('fbclid');
  });
});
