import { ProviderCallError } from '../../../application/ports/AiVisibility';
import type { RawCitation } from '../../../domain/ai-visibility/Citations';
import { normalizeHost } from '../../../domain/ai-visibility/Domains';

/**
 * Shared transport for answer-engine adapters. Fixed provider hosts only (no
 * caller-supplied URLs, so no SSRF surface), a hard timeout, and the API key
 * sent only in a header — never logged, never placed in a URL except where the
 * provider requires it (Gemini's key header is used instead of ?key=).
 */
export async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<{ json: unknown; latencyMs: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  let res: Response;
  let text: string;
  // The timer covers the whole exchange, body included: a server that sends
  // headers and then stalls must not hold a worker past the timeout.
  try {
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || ctrl.signal.aborted) throw new ProviderCallError(`No answer within ${Math.round(timeoutMs / 1000)}s.`, null, 'TIMEOUT');
      throw new ProviderCallError('The provider could not be reached.', null, 'NETWORK');
    }
    try {
      text = await res.text();
    } catch {
      // Headers arrived, so the provider did the work (and may have billed it):
      // counted as a timeout, which the spend rules treat as possibly billed.
      throw new ProviderCallError(ctrl.signal.aborted ? `No answer within ${Math.round(timeoutMs / 1000)}s.` : `The reply was cut off after HTTP ${res.status}.`, res.status, 'TIMEOUT');
    }
  } finally {
    clearTimeout(t);
  }
  const latencyMs = Date.now() - started;
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    // Provider error messages are safe to show (they never echo the key), trimmed.
    const msg = (json as { error?: { message?: string } } | null)?.error?.message ?? text.slice(0, 200);
    throw new ProviderCallError(`HTTP ${res.status}: ${String(msg).slice(0, 300)}`, res.status, 'HTTP');
  }
  if (json === null) throw new ProviderCallError('The provider returned a response that is not JSON.', res.status, 'PARSE');
  return { json, latencyMs };
}

/** Hosts that are the answer engines themselves; never counted as cited sources. */
const ENGINE_SELF_HOSTS = ['chatgpt.com', 'openai.com', 'perplexity.ai', 'gemini.google.com', 'claude.ai', 'anthropic.com', 'vertexaisearch.cloud.google.com'];

export function dedupeCitations(list: RawCitation[]): RawCitation[] {
  const seen = new Set<string>();
  const out: RawCitation[] = [];
  for (const c of list) {
    const host = normalizeHost(c.url);
    if (!host || ENGINE_SELF_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) continue;
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push({ ...c, position: out.length + 1 });
  }
  return out;
}

export const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A failure after which the provider may still have charged: timeout, 5xx, or an error inside a 200 reply. */
export function possiblyBilled(e: unknown): boolean {
  if (!(e instanceof ProviderCallError)) return false;
  return e.code === 'TIMEOUT' || (e.status != null && (e.status >= 500 || e.status === 200));
}
