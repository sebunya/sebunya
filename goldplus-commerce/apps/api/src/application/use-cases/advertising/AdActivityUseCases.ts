import type { AdActivityRepository, AdActivityRecord } from '../../ports/AdActivity';
import {
  AD_OUTCOMES, PLATFORM_CLICK, activityWindow, daysOfWindow, explainOutcome, isOutOfScope, topReason, type ActivityCount, type AdOutcome,
} from '../../../domain/advertising/AdActivity';
import { EARLY_SIGNAL_LABEL, eventSelected } from '../../../domain/advertising/OptimisationEvents';

/** What the use case needs to know about a platform; supplied by the destination use cases. */
export interface ActivityPlatform {
  key: string;
  name: string;
  state: string;
  unavailable?: string | null;
  events: Record<string, string>;
  row: { enabled?: boolean; config?: Record<string, string> | null; eventSelection?: string[] | null; lastSuccessAt?: string | null; lastError?: string | null; lastErrorAt?: string | null } | null;
}

type Tally = Record<AdOutcome, number>;
const zero = (): Tally => ({ sent: 0, not_sent: 0, failed: 0, waiting: 0 });
const LABEL: Record<string, string> = { ...EARLY_SIGNAL_LABEL, purchase: 'Purchase' };
// The order a shopper meets them in, so the table reads as a journey.
const EVENT_ORDER = ['view_item', 'add_to_cart', 'begin_checkout', 'add_payment_info', 'generate_lead', 'search', 'sign_up', 'find_location', 'purchase'];

/**
 * Advertising activity (2026-10-01): for one platform and one window, where
 * visitors from its ads arrive, how many are recognised, which events were
 * raised for them and what became of each. Read-only; it sends nothing.
 */
export class AdActivityUseCases {
  constructor(
    private readonly repo: AdActivityRepository,
    private readonly platforms: () => Promise<ActivityPlatform[]>,
    /**
     * The platform-side event ID for a shop event. `undefined` means the
     * platform has no per-event ID (most of them); `null` means it needs one
     * (X) and none is saved, so that event is never sent.
     */
    private readonly eventIdOf: (platform: string, config: Record<string, string>, event: string) => string | null | undefined = () => undefined,
  ) {}

  /**
   * `includeOutOfScope` only widens the list of latest deliveries. The
   * headline numbers, the per-event rows and the chart always leave out
   * events that were never the platform's to count, and report them once
   * as `outOfScope`.
   */
  async view(platformKey: string | undefined, rawDays: unknown, includeOutOfScope = false) {
    const all = (await this.platforms()).filter((p) => !p.unavailable);
    const platform = all.find((p) => p.key === platformKey) ?? all.find((p) => p.state === 'LIVE' || p.state === 'TEST') ?? all.find((p) => p.key === 'x') ?? all[0];
    if (!platform) return null;
    const days = activityWindow(rawDays);
    const today = await this.repo.today();
    const window = daysOfWindow(today, days);
    const since = window[0];
    const click = PLATFORM_CLICK[platform.key] ?? null;
    const [allCounts, recent, arrivals, recognised] = await Promise.all([
      this.repo.counts(platform.key, since),
      this.repo.recent(platform.key, since, 50, includeOutOfScope),
      click ? this.repo.arrivals(click.param, since) : Promise.resolve([]),
      click?.column ? this.repo.recognised(click.column, since) : Promise.resolve(null),
    ]);
    const config = platform.row?.config ?? {};
    const scope = platform.key === 'x' ? (config.sendScope === 'all' ? 'all' : 'x_clicks') : null;
    // "Meta (Facebook, Instagram, WhatsApp ads)" is a title, not a word for a sentence.
    const spoken = platform.name.replace(/\s*\([^)]*\)/g, '').trim() || platform.name;
    const explain = (outcome: AdOutcome, raw: string | null) => explainOutcome({ platformName: spoken, outcome, raw });
    const counts = allCounts.filter((c) => !isOutOfScope(c.reason));
    const outOfScope = allCounts.filter((c) => isOutOfScope(c.reason)).reduce((s, c) => s + c.n, 0);

    const total = zero();
    for (const c of counts) total[c.outcome] += c.n;

    const eventKeys = [...new Set([...EVENT_ORDER.filter((e) => platform.events[e]), ...Object.keys(platform.events), ...counts.map((c) => c.event)])];
    const events = eventKeys.map((event) => {
      const mine = counts.filter((c) => c.event === event);
      const t = zero();
      for (const c of mine) t[c.outcome] += c.n;
      const lastSentAt = mine.filter((c) => c.outcome === 'sent' && c.lastAt).map((c) => c.lastAt as string).sort().pop() ?? null;
      const stopped = topReason(mine.filter((c) => c.outcome === 'not_sent' || c.outcome === 'failed'));
      const stoppedOutcome: AdOutcome = mine.some((c) => c.outcome === 'failed' && (c.reason ?? null) === (stopped?.reason ?? null)) ? 'failed' : 'not_sent';
      const eventId = this.eventIdOf(platform.key, config, event);
      const mapped = !!platform.events[event];
      // A platform with one ID per event (X) sends an event only when its ID is saved.
      const configured = mapped && (eventId === undefined || !!eventId);
      return {
        event, label: LABEL[event] ?? event, platformEvent: platform.events[event] ?? null, eventId: eventId ?? null,
        mapped, configured, selected: eventSelected(platform.row?.eventSelection ?? null, event),
        ...t, lastSentAt,
        mainReason: stopped && stopped.n > 0 ? { text: explain(stoppedOutcome, stopped.reason), n: stopped.n } : null,
      };
    });

    const arrivalsByDay = new Map(arrivals.map((a) => [a.day, a.n]));
    const daily = window.map((day) => {
      const t = zero();
      for (const c of counts) if (c.day === day) t[c.outcome] += c.n;
      return { day, ...t, arrivals: arrivalsByDay.get(day) ?? 0 };
    });

    return {
      platform: platform.key, name: platform.name, state: platform.state, days, since, today,
      enabled: !!platform.row?.enabled, scope,
      lastSuccessAt: platform.row?.lastSuccessAt ?? null, lastError: platform.row?.lastError ?? null, lastErrorAt: platform.row?.lastErrorAt ?? null,
      funnel: {
        clickParam: click?.param ?? null,
        arrivals: click ? arrivals.reduce((s, a) => s + a.n, 0) : null,
        recognised,
        raised: AD_OUTCOMES.reduce((s, o) => s + total[o], 0),
        ...total,
      },
      events, daily,
      /** Events from visitors who did not come from this platform's ad: seen, never sent, and in none of the numbers above. */
      outOfScope, showingOutOfScope: includeOutOfScope,
      recent: recent.map((r: AdActivityRecord) => ({ ...r, label: LABEL[r.event] ?? r.event, explanation: explain(r.outcome, r.reason) })),
      platforms: all.map((p) => ({ key: p.key, name: p.name, state: p.state })),
    };
  }
}

export type AdActivityView = NonNullable<Awaited<ReturnType<AdActivityUseCases['view']>>>;
export type { ActivityCount };
