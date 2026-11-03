import type { APIRoute } from 'astro';
import { indexNowKey } from '../lib/indexNowKey';

/**
 * IndexNow key-file verification (protocol: https://host/{key}.txt must return
 * the key). This dynamic route answers ONLY when the requested filename matches
 * the API's configured INDEXNOW_KEY (per protocol the key is public, not a
 * secret); every other /*.txt path 404s. Static routes (robots.txt) win over
 * this dynamic one, so nothing existing is shadowed.
 */
export const GET: APIRoute = async ({ params }) => {
  const requested = (params.key ?? '').trim();
  // IndexNow keys are 8–128 chars of [a-zA-Z0-9-]; refuse anything else early.
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(requested)) {
    return new Response('Not found', { status: 404 });
  }
  // Cached in memory (lib/indexNowKey): a scan of random .txt paths no longer
  // costs one API round trip each.
  const key = await indexNowKey();
  if (!key || key !== requested) return new Response('Not found', { status: 404 });
  return new Response(key, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
};
