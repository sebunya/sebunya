// HTTP with bounded retries. Every provider call goes through here so 429,
// 5xx, timeouts and malformed JSON are handled once, the same way.
import { redactText } from './redact.mjs';

export class HttpError extends Error {
  constructor(message, { status = null, retryable = false, body = null } = {}) {
    super(message); this.status = status; this.retryable = retryable; this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetchJson(url, { method, headers, body, timeoutMs, retries, backoffMs, expectJson })
 * Retries on 429 (honouring Retry-After when sane), 5xx and network/timeout
 * errors with exponential backoff; never on 4xx other than 429. Bounded.
 */
export async function fetchJson(url, opts = {}) {
  const { method = 'GET', headers = {}, body, timeoutMs = 30000, retries = 3, backoffMs = 2000, expectJson = true, fetchImpl = fetch } = opts;
  let attempt = 0; let lastErr = null;
  while (attempt <= retries) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { method, headers, body, signal: ctl.signal, redirect: 'follow' });
      clearTimeout(t);
      const text = await res.text();
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(ra) && ra > 0 && ra <= 120 ? ra * 1000 : backoffMs * 2 ** attempt;
        lastErr = new HttpError(`HTTP ${res.status} from ${redactText(url)}`, { status: res.status, retryable: true, body: text.slice(0, 500) });
        if (attempt === retries) throw lastErr;
        await sleep(wait); attempt++; continue;
      }
      if (!res.ok) throw new HttpError(`HTTP ${res.status} from ${redactText(url)}: ${text.slice(0, 300)}`, { status: res.status, retryable: false, body: text.slice(0, 500) });
      if (!expectJson) return { status: res.status, headers: res.headers, text };
      try { return { status: res.status, headers: res.headers, json: JSON.parse(text), text }; }
      catch { throw new HttpError(`Malformed JSON from ${redactText(url)}: ${text.slice(0, 200)}`, { status: res.status, retryable: false }); }
    } catch (e) {
      clearTimeout(t);
      if (e instanceof HttpError && !e.retryable) throw e;
      lastErr = e instanceof HttpError ? e : new HttpError(`${e.name === 'AbortError' ? 'Timeout' : 'Network error'} calling ${redactText(url)}: ${e.message}`, { retryable: true });
      if (attempt === retries) throw lastErr;
      await sleep(backoffMs * 2 ** attempt); attempt++;
    }
  }
  throw lastErr;
}

/** Poll until `done(result)` is true, with a hard deadline. Never polls forever. */
export async function pollUntil(fn, { done, intervalMs = 5000, deadlineMs = 600000, maxIntervalMs = 30000 }) {
  const start = Date.now(); let interval = intervalMs; let last;
  while (Date.now() - start < deadlineMs) {
    last = await fn();
    if (done(last)) return last;
    await sleep(interval); interval = Math.min(maxIntervalMs, Math.round(interval * 1.5));
  }
  throw new HttpError(`Polling exceeded ${Math.round(deadlineMs / 1000)}s deadline`, { retryable: false });
}
