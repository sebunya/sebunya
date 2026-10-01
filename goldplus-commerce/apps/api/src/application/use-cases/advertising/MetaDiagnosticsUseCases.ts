import { createHash, randomUUID } from 'node:crypto';
import type { MetaAnswer, MetaDiagnosticsGateway } from '../../ports/MetaDiagnostics';
import type { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { META_KEYS_SENT, isMetaTestEventCode, parseDatasetQuality, type MetaEventQuality } from '../../../domain/advertising/MetaDiagnostics';

/** The Meta destination as saved: the dataset, the token (read just in time), and whether it is on. */
export interface MetaDestination { datasetId: string; token: string; enabled: boolean; mode: 'live' | 'test' }

type Check<T> = { state: 'ok'; value: T } | { state: 'refused'; message: string; credentials: boolean } | { state: 'unavailable'; message: string };

export interface MetaDiagnosticsView {
  configured: boolean;
  /** Why nothing was asked of Meta (no dataset ID, no token, the vault cannot be read). */
  notConfigured: string | null;
  datasetId: string | null;
  connection: Check<{ name: string | null }> | null;
  quality: Check<{ events: MetaEventQuality[] }> | null;
  keysSent: typeof META_KEYS_SENT;
  checkedAt: string | null;
}

const CACHE_MS = 10 * 60_000;

/**
 * What Meta itself says about the dataset (2026-10-01): that the ID and
 * token work, and how well it can match what it receives. Read-only except
 * for `sendTestEvent`, which the owner triggers and which is audited.
 *
 * Meta's answers are cached for ten minutes per dataset: the page is opened
 * often, the figures move daily, and a slow Graph call should not make the
 * page slow every time.
 */
export class MetaDiagnosticsUseCases {
  private cache: { key: string; at: number; view: MetaDiagnosticsView } | null = null;

  constructor(
    private readonly gateway: MetaDiagnosticsGateway,
    /** THROWS a readable "Not configured: …" message when there is nothing to ask Meta with. */
    private readonly destination: () => Promise<MetaDestination>,
    private readonly audit: CreateAuditLogUseCase,
    private readonly siteOrigin: () => string | null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private static check<T, V>(a: MetaAnswer<T>, map: (v: T) => V): Check<V> {
    if (a.ok) return { state: 'ok', value: map(a.value) };
    // A fault on Meta's side is not a verdict on the setup.
    return a.transient ? { state: 'unavailable', message: a.message } : { state: 'refused', message: a.message, credentials: a.credentials };
  }

  async overview(fresh = false): Promise<MetaDiagnosticsView> {
    let dest: MetaDestination;
    try { dest = await this.destination(); } catch (err) {
      return { configured: false, notConfigured: (err as Error).message, datasetId: null, connection: null, quality: null, keysSent: META_KEYS_SENT, checkedAt: null };
    }
    // Keyed on the dataset and a digest of the token, so a re-entered token is checked at once.
    const key = `${dest.datasetId}:${createHash('sha256').update(dest.token).digest('hex').slice(0, 16)}`;
    if (!fresh && this.cache && this.cache.key === key && this.now() - this.cache.at < CACHE_MS) return this.cache.view;
    const [dataset, quality] = await Promise.all([
      this.gateway.dataset(dest.datasetId, dest.token).catch((e): MetaAnswer<never> => ({ ok: false, message: `Meta could not be reached: ${(e as Error).message}`, credentials: false, transient: true })),
      this.gateway.quality(dest.datasetId, dest.token).catch((e): MetaAnswer<never> => ({ ok: false, message: `Meta could not be reached: ${(e as Error).message}`, credentials: false, transient: true })),
    ]);
    const view: MetaDiagnosticsView = {
      configured: true, notConfigured: null, datasetId: dest.datasetId,
      connection: MetaDiagnosticsUseCases.check(dataset, (d) => ({ name: d.name })),
      quality: MetaDiagnosticsUseCases.check(quality, (q) => ({ events: parseDatasetQuality(q) })),
      keysSent: META_KEYS_SENT, checkedAt: new Date(this.now()).toISOString(),
    };
    // A fault on Meta's side is not remembered: the next look asks again.
    if (view.connection?.state !== 'unavailable' && view.quality?.state !== 'unavailable') this.cache = { key, at: this.now(), view };
    return view;
  }

  /**
   * One ViewContent carrying the owner's test event code. Meta lists it under
   * Events Manager > Test events and does not count it. It describes no real
   * visitor: the identifier is a fixed label, hashed, and the event says so.
   */
  async sendTestEvent(actorId: string | null, testEventCode: unknown): Promise<{ ok: true; eventsReceived: number; eventId: string; fbtraceId: string | null } | { ok: false; message: string }> {
    if (!isMetaTestEventCode(testEventCode)) return { ok: false, message: 'Enter the test event code from Events Manager > your dataset > Test events (it starts with TEST).' };
    let dest: MetaDestination;
    try { dest = await this.destination(); } catch (err) { return { ok: false, message: (err as Error).message }; }
    const origin = this.siteOrigin();
    if (!origin) return { ok: false, message: 'The storefront address is not set on the server (PUBLIC_SITE_ORIGIN), and Meta requires the page a website event came from.' };
    const eventId = `goldplus-connection-test-${randomUUID()}`;
    const event = {
      event_name: 'ViewContent', event_time: Math.floor(this.now() / 1000), event_id: eventId, action_source: 'website',
      event_source_url: `${origin}/`,
      user_data: { external_id: [createHash('sha256').update('goldplus-connection-test').digest('hex')], client_user_agent: 'GoldPlus connection test (not a visitor)' },
      custom_data: { currency: 'UGX', value: 0, content_type: 'product', content_name: 'Connection test' },
      data_processing_options: [],
    };
    const code = testEventCode.trim();
    const answer = await this.gateway.sendTestEvent(dest.datasetId, dest.token, event, code)
      .catch((e): MetaAnswer<never> => ({ ok: false, message: `Meta could not be reached: ${(e as Error).message}`, credentials: false, transient: true }));
    await this.audit.execute({ actorId, action: 'AD_TEST_EVENT_SENT', entity: 'ad_destination', entityId: 'meta',
      newState: { datasetId: dest.datasetId, eventId, accepted: answer.ok, ...(answer.ok ? { eventsReceived: answer.value.eventsReceived } : { refusal: answer.message.slice(0, 300) }) } } as never);
    if (!answer.ok) return { ok: false, message: answer.message };
    return { ok: true, eventsReceived: answer.value.eventsReceived, eventId, fbtraceId: answer.value.fbtraceId };
  }
}
