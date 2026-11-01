import type { SeoPageFetcher, SeoPageFetchResult } from '../../application/use-cases/seo-growth/CrawlSiteUseCase';

/**
 * Undici/global-fetch adapter for the first-party crawler.
 * redirect: 'manual' on purpose — the use case follows hops itself so every
 * hop passes the SSRF allowlist. 10s hard timeout per request.
 */
const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 2_000_000;

/**
 * Read at most `max` bytes, then stop: a huge or endless page is never
 * buffered whole (res.text() did). The page is truncated, as before.
 */
export async function readTruncatedText(res: Response, max: number = MAX_BODY_BYTES): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = max - total;
    if (value.byteLength >= room) {
      chunks.push(value.subarray(0, room));
      total = max;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class FetchSeoPageFetcher implements SeoPageFetcher {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async fetchPage(url: string): Promise<SeoPageFetchResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'GoldPlusSeoAuditBot/1.0 (+https://www.shopgoldplus.com)' },
      });
      const contentType = res.headers.get('content-type');
      const location = res.headers.get('location');
      let body: string | null = null;
      if ((contentType ?? '').toLowerCase().includes('text/html')) {
        body = await readTruncatedText(res);
      } else {
        await res.body?.cancel().catch(() => {});
      }
      return { status: res.status, contentType, location, body, responseMs: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }
}
