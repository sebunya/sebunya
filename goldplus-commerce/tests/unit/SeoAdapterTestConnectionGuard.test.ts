import { describe, expect, it } from 'vitest';
import { adapterFor, withTimeout } from '../../apps/api/src/infrastructure/seo/adapters/SeoIntegrationAdapters';

const conn = { config: { siteUrl: 'https://goldplus.ug/' } } as never;

describe('SEO provider testConnection never throws and always has a deadline', () => {
  it('a network error becomes a failed PROVIDER_UNAVAILABLE test', async () => {
    const boom = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const r = await adapterFor('bing-webmaster', boom)!.testConnection(conn, { apiKey: 'k' } as never);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('PROVIDER_UNAVAILABLE');
  });

  it('every fetch gets an abort signal', async () => {
    let seen: AbortSignal | undefined;
    const f = withTimeout((async (_u: unknown, init?: RequestInit) => { seen = init?.signal ?? undefined; return new Response('{}'); }) as unknown as typeof fetch, 50);
    await f('https://x.example');
    expect(seen).toBeInstanceOf(AbortSignal);
  });
});
