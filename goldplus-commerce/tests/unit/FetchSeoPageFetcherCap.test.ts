import { describe, expect, it } from 'vitest';
import { FetchSeoPageFetcher, readTruncatedText } from '../../apps/api/src/infrastructure/seo/FetchSeoPageFetcher';

describe('SEO crawler reads at most 2 MB of a page', () => {
  it('stops reading an endless stream at the cap', async () => {
    let pulled = 0;
    const chunk = new Uint8Array(64 * 1024).fill(97);
    const endless = new ReadableStream<Uint8Array>({ pull(c) { pulled += 1; c.enqueue(chunk); } });
    const text = await readTruncatedText(new Response(endless), 200_000);
    expect(text.length).toBe(200_000);
    expect(pulled).toBeLessThan(10);
  });

  it('the fetcher returns a truncated html body', async () => {
    const big = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(1_000_000).fill(98)); } });
    const f = (async () => new Response(big, { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    const r = await new FetchSeoPageFetcher(f).fetchPage('https://shopgoldplus.com/');
    expect(r.body?.length).toBe(2_000_000);
  });
});
