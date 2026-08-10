import type { SeoPageFetcher, SeoPageFetchResult } from '../../application/use-cases/seo-growth/CrawlSiteUseCase';

/**
 * Undici/global-fetch adapter for the first-party crawler.
 * redirect: 'manual' on purpose — the use case follows hops itself so every
 * hop passes the SSRF allowlist. 10s hard timeout per request.
 */
const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 2_000_000;

export class FetchSeoPageFetcher implements SeoPageFetcher {
  async fetchPage(url: string): Promise<SeoPageFetchResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'GoldPlusSeoAuditBot/1.0 (+https://www.shopgoldplus.com)' },
      });
      const contentType = res.headers.get('content-type');
      const location = res.headers.get('location');
      let body: string | null = null;
      if ((contentType ?? '').toLowerCase().includes('text/html')) {
        const text = await res.text();
        body = text.length > MAX_BODY_BYTES ? text.slice(0, MAX_BODY_BYTES) : text;
      }
      return { status: res.status, contentType, location, body, responseMs: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }
}
