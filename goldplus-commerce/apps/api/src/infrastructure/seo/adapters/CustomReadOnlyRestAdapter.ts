import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import type {
  SeoIntegrationAdapter,
  SeoIntegrationConnectionView,
  SeoIntegrationSecret,
  SeoIntegrationTestResult,
  SeoIntegrationTestStageResult,
} from '../../../application/ports/SeoIntegrationAdapter';

/**
 * CustomReadOnlyRestAdapter — LEVEL 2 custom connector: read-only GET-only
 * JSON over https against a hostname allowlist, with SSRF protections:
 *   - https only, no IP-literal hosts
 *   - hostname must be on the connection's explicit allowlist
 *   - DNS is resolved and every resolved address checked against private /
 *     loopback / link-local / metadata ranges
 *   - redirects are followed manually (max 2) and each hop must stay on the
 *     SAME host and re-pass all checks — off-host redirects are refused
 *   - the connection is PINNED to the addresses that passed the check (no
 *     second DNS lookup at connect time, so DNS rebinding cannot swap in an
 *     internal address between check and connect)
 *   - 10s timeout covering headers AND body, 1 MB body cap, JSON only
 * The 100 requests/day cap is enforced by the caller via
 * seo_integration_usage (tryConsumeUsage) before any network call.
 */

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 2;
export const MAX_BODY_BYTES = 1_000_000;

export function isPrivateAddress(addr: string): boolean {
  const family = isIP(addr);
  if (family === 4) {
    const parts = addr.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (family === 6) {
    const lower = addr.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7)); // v4-mapped
    return false;
  }
  return false;
}

export interface CustomRequestValidation { ok: boolean; reason?: string; addresses?: string[] }

/**
 * Validate a custom-connector request. method must be GET; url must be https,
 * non-IP-literal, on the allowlist; DNS resolution (injectable for tests) must
 * yield only public addresses.
 */
export async function validateCustomRequest(
  input: { url: string; method: string; allowedHosts: string[] },
  resolveHost: (host: string) => Promise<string[]> = async (host) =>
    (await lookup(host, { all: true })).map((r) => r.address),
): Promise<CustomRequestValidation> {
  if (input.method.toUpperCase() !== 'GET') {
    return { ok: false, reason: 'Only GET requests are permitted on the custom read-only connector.' };
  }
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return { ok: false, reason: 'URL is not valid.' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'Only https URLs are permitted.' };
  if (url.username || url.password) return { ok: false, reason: 'URLs with embedded credentials are refused.' };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) return { ok: false, reason: 'IP-literal hosts are refused; use a hostname on the allowlist.' };
  const allow = input.allowedHosts.map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!allow.includes(host)) return { ok: false, reason: `Host ${host} is not on the connection allowlist.` };
  let addresses: string[];
  try {
    addresses = await resolveHost(host);
  } catch {
    return { ok: false, reason: `Host ${host} did not resolve.` };
  }
  if (addresses.length === 0) return { ok: false, reason: `Host ${host} did not resolve.` };
  for (const addr of addresses) {
    if (isPrivateAddress(addr)) {
      return { ok: false, reason: `Host ${host} resolves to a private or internal address; refused.` };
    }
  }
  return { ok: true, addresses };
}

/**
 * A fetch that connects only to `addresses` (already checked public). TLS
 * still verifies the certificate against the URL's hostname (SNI/servername).
 */
export function pinnedFetch(addresses: string[]): typeof fetch {
  return ((input: string | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const url = new URL(String(input));
    const address = addresses[0];
    const family = isIP(address);
    const req = httpsRequest({
      hostname: url.hostname,
      servername: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: init?.headers as Record<string, string> | undefined,
      signal: init?.signal ?? undefined,
      lookup: ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
        if (opts?.all) cb(null, [{ address, family }]);
        else cb(null, address, family);
      }) as never,
    }, (res) => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
      }
      const status = res.statusCode ?? 502;
      const body = status === 204 || status === 304 ? null : (Readable.toWeb(res) as unknown as ReadableStream);
      try {
        resolve(new Response(body, { status, headers }));
      } catch (err) {
        res.destroy();
        reject(err);
      }
    });
    req.on('error', reject);
    req.end();
  })) as typeof fetch;
}

/** Read a body up to `max` bytes; over the cap -> null (the reader is cancelled). */
export async function readCappedText(res: Response, max: number = MAX_BODY_BYTES, signal?: AbortSignal): Promise<string | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  // A body that drips forever is cut by the caller's timer even when the
  // stream itself ignores the abort signal.
  const onAbort = () => { reader.cancel(new Error('aborted')).catch(() => {}); };
  if (signal?.aborted) onAbort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    if (signal?.aborted) throw new Error('aborted');
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function performCustomGet(
  input: { url: string; allowedHosts: string[]; headerName?: string | null; headerValue?: string | null },
  fetchImpl?: typeof fetch,
  resolveHost?: (host: string) => Promise<string[]>,
): Promise<{ ok: boolean; status?: number; reason?: string; json?: unknown }> {
  let currentUrl = input.url;
  const originalHost = (() => { try { return new URL(input.url).hostname.toLowerCase(); } catch { return ''; } })();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const validation = await validateCustomRequest({ url: currentUrl, method: 'GET', allowedHosts: input.allowedHosts }, resolveHost);
    if (!validation.ok) return { ok: false, reason: validation.reason };
    if (new URL(currentUrl).hostname.toLowerCase() !== originalHost) {
      return { ok: false, reason: 'Redirect left the original host; refused.' };
    }
    // One timer for the whole hop: headers and body. Cleared on every exit.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      let res: Response;
      try {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (input.headerName && input.headerValue) headers[input.headerName] = input.headerValue;
        const doFetch = fetchImpl ?? pinnedFetch(validation.addresses ?? []);
        res = await doFetch(currentUrl, { method: 'GET', headers, redirect: 'manual', signal: controller.signal });
      } catch (err: any) {
        return { ok: false, reason: `Request failed: ${String(err?.message ?? err).slice(0, 200)}` };
      }
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => {});
        const location = res.headers.get('location');
        if (!location) return { ok: false, reason: 'Redirect without a Location header; refused.' };
        const next = new URL(location, currentUrl).toString();
        if (new URL(next).hostname.toLowerCase() !== originalHost) {
          return { ok: false, reason: 'Redirect to an off-host location; refused.' };
        }
        currentUrl = next;
        continue;
      }
      if (!res.ok) return { ok: false, status: res.status, reason: `Upstream returned ${res.status}.` };
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('json')) return { ok: false, status: res.status, reason: 'Response is not JSON; only JSON sources are supported.' };
      let text: string | null;
      try {
        text = await readCappedText(res, MAX_BODY_BYTES, controller.signal);
      } catch (err: any) {
        return { ok: false, status: res.status, reason: controller.signal.aborted ? 'Response body timed out.' : `Body read failed: ${String(err?.message ?? err).slice(0, 200)}` };
      }
      if (text === null) return { ok: false, status: res.status, reason: `Response body is larger than ${MAX_BODY_BYTES} bytes; refused.` };
      try {
        return { ok: true, status: res.status, json: JSON.parse(text) };
      } catch {
        return { ok: false, status: res.status, reason: 'Response body is not valid JSON.' };
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, reason: 'Too many redirects.' };
}

export class CustomReadOnlyRestAdapter implements SeoIntegrationAdapter {
  readonly providerId = 'custom-readonly-rest';

  constructor(
    private readonly fetchImpl?: typeof fetch,
    private readonly resolveHost?: (host: string) => Promise<string[]>,
  ) {}

  async testConnection(connection: SeoIntegrationConnectionView, secret: SeoIntegrationSecret): Promise<SeoIntegrationTestResult> {
    const stages: SeoIntegrationTestStageResult[] = [];
    const baseUrl = String(connection.config.baseUrl ?? '');
    const allowedHosts = String(connection.config.allowedHosts ?? '').split(',');
    const headerName = connection.config.headerName ? String(connection.config.headerName) : null;
    const token = secret && typeof secret.token === 'string' ? secret.token : null;
    if (baseUrl === '') {
      stages.push({ stage: 'ENDPOINT', ok: false, detail: 'baseUrl is not configured.' });
      return { ok: false, stages, errorCode: 'CONFIGURATION_ERROR', errorMessage: 'baseUrl is not configured.' };
    }
    const result = await performCustomGet(
      { url: baseUrl, allowedHosts, headerName, headerValue: token },
      this.fetchImpl,
      this.resolveHost,
    );
    stages.push({ stage: 'ENDPOINT', ok: result.ok, detail: result.ok ? `GET ${new URL(baseUrl).hostname} returned JSON (${result.status}).` : (result.reason ?? 'Request refused.') });
    if (!result.ok) {
      return { ok: false, stages, errorCode: 'CONFIGURATION_ERROR', errorMessage: result.reason ?? 'Request refused.' };
    }
    return { ok: true, stages };
  }
}
