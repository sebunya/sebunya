import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
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
 *   - 10s timeout, JSON responses only
 * The 100 requests/day cap is enforced by the caller via
 * seo_integration_usage (tryConsumeUsage) before any network call.
 */

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 2;

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

export interface CustomRequestValidation { ok: boolean; reason?: string }

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
  return { ok: true };
}

export async function performCustomGet(
  input: { url: string; allowedHosts: string[]; headerName?: string | null; headerValue?: string | null },
  fetchImpl: typeof fetch = fetch,
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (input.headerName && input.headerValue) headers[input.headerName] = input.headerValue;
      res = await fetchImpl(currentUrl, { method: 'GET', headers, redirect: 'manual', signal: controller.signal });
    } catch (err: any) {
      return { ok: false, reason: `Request failed: ${String(err?.message ?? err).slice(0, 200)}` };
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
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
    try {
      return { ok: true, status: res.status, json: await res.json() };
    } catch {
      return { ok: false, status: res.status, reason: 'Response body is not valid JSON.' };
    }
  }
  return { ok: false, reason: 'Too many redirects.' };
}

export class CustomReadOnlyRestAdapter implements SeoIntegrationAdapter {
  readonly providerId = 'custom-readonly-rest';

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
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
