import type { APIRoute } from 'astro';
import { apiBase } from '../lib/api';

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
  try {
    const res = await fetch(`${apiBase}/seo/indexnow-key`);
    if (!res.ok) return new Response('Not found', { status: 404 });
    const body = (await res.json()) as { success?: boolean; data?: { key?: string } };
    const key = body?.data?.key;
    if (!key || key !== requested) return new Response('Not found', { status: 404 });
    return new Response(key, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};
