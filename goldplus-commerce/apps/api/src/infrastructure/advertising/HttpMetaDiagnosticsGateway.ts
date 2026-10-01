import type { MetaAnswer, MetaDiagnosticsGateway } from '../../application/ports/MetaDiagnostics';
import { META_GRAPH_VERSION, metaErrorSummary } from './AdPlatforms';

/**
 * Graph API calls about one dataset (2026-10-01). The host is fixed; the token
 * travels in the Authorization header, never in a URL (proxy and access logs
 * keep URLs); nothing here logs a request or a response body.
 */
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const DATASET_ID = /^\d{10,20}$/;

export class HttpMetaDiagnosticsGateway implements MetaDiagnosticsGateway {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async call<T>(url: string, token: string, init: { method: 'GET' | 'POST'; body?: unknown }, map: (json: any) => T): Promise<MetaAnswer<T>> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: init.method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        redirect: 'manual', signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      return { ok: false, message: `Meta could not be reached (${(err as Error).name === 'TimeoutError' ? 'no answer in 10 seconds' : 'network error'}).`, credentials: false, transient: true };
    }
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      const told = metaErrorSummary(res.status, text);
      if (told) return { ok: false, message: told.message, credentials: told.credentials, transient: told.transient };
      return { ok: false, message: `Meta answered HTTP ${res.status} with no explanation.`, credentials: res.status === 401 || res.status === 403, transient: res.status >= 500 || res.status === 429 };
    }
    let json: unknown;
    try { json = JSON.parse(text); } catch { return { ok: false, message: 'Meta answered with something that is not JSON.', credentials: false, transient: true }; }
    // Meta names the version it actually used. When the pinned one has been
    // retired it serves a newer one without failing the call; this is the
    // only place that shows.
    return { ok: true, value: map(json), servedVersion: res.headers.get('facebook-api-version') };
  }

  private static assertId(datasetId: string): void {
    // The ID is validated when saved; checked again here because it becomes part of a URL.
    if (!DATASET_ID.test(datasetId)) throw new Error('The dataset ID is not a Meta dataset ID.');
  }

  async dataset(datasetId: string, token: string) {
    HttpMetaDiagnosticsGateway.assertId(datasetId);
    return this.call(`${GRAPH}/${datasetId}?fields=id,name`, token, { method: 'GET' }, (j) => ({ id: String(j?.id ?? datasetId), name: typeof j?.name === 'string' ? j.name : null }));
  }

  async quality(datasetId: string, token: string) {
    HttpMetaDiagnosticsGateway.assertId(datasetId);
    const fields = encodeURIComponent('web{event_name,event_match_quality}');
    return this.call<unknown>(`${GRAPH}/dataset_quality?dataset_id=${datasetId}&fields=${fields}`, token, { method: 'GET' }, (j) => j);
  }

  async sendTestEvent(datasetId: string, token: string, event: Record<string, unknown>, testEventCode: string) {
    HttpMetaDiagnosticsGateway.assertId(datasetId);
    return this.call(`${GRAPH}/${datasetId}/events`, token, { method: 'POST', body: { test_event_code: testEventCode, data: [event] } },
      (j) => ({ eventsReceived: Number(j?.events_received ?? 0), fbtraceId: typeof j?.fbtrace_id === 'string' ? j.fbtrace_id : null }));
  }
}
