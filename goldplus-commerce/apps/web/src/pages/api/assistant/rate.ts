import type { APIRoute } from 'astro';
import { readBodyCapped } from '../../../lib/boundedBody';
import { apiBase } from '../../../lib/api';

/**
 * POST /api/assistant/rate: the customer's rating of this chat (thumbs: 5 or 1), with an optional word.
 * Filed on the archived conversation; a low rating goes on the Care Desk to win the customer back.
 * Budgeted per visitor in the middleware.
 */
export const prerender = false;
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request }) => {
  const read = await readBodyCapped(request, 4096);
  if (!read.ok) return json({ success: false }, 413);
  let b: Record<string, unknown> | null = null;
  try { b = JSON.parse(read.text); } catch { b = null; }
  const key = typeof b?.conversationId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.conversationId) ? b.conversationId : null;
  const score = Number(b?.score);
  if (!key || !Number.isInteger(score) || score < 1 || score > 5) return json({ success: false, error: { code: 'INVALID_BODY', message: 'Send a rating.' } }, 400);
  try {
    const res = await fetch(`${apiBase}/internal/assistant/csat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationKey: key, score, comment: typeof b?.comment === 'string' ? b.comment.slice(0, 500) : null }), signal: AbortSignal.timeout(4000) });
    return json({ success: res.ok }, res.ok ? 200 : 202);
  } catch { return json({ success: false }, 202); }
};
