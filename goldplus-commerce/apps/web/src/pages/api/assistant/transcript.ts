import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { readBodyCapped } from '../../../lib/boundedBody';
import { emailTranscript } from '../../../lib/assistantConversation';

/**
 * POST /api/assistant/transcript: email the shopper a copy of their chat.
 * Body: { email, firstName?, turns }. Links are removed from the shopper's own
 * lines and each address gets at most three copies a day (API), on top of the
 * per-visitor budget in the middleware, so this cannot be used to send mail.
 */
export const prerender = false;

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request }) => {
  const read = await readBodyCapped(request, 64 * 1024);
  if (!read.ok) return json({ success: false, error: { code: 'TOO_LARGE', message: 'That conversation is too long to send.' } }, 413);
  let b: Record<string, unknown> | null = null;
  try { b = JSON.parse(read.text); } catch { b = null; }
  const email = typeof b?.email === 'string' ? b.email.trim().slice(0, 200) : '';
  if (!b || !email || !Array.isArray(b.turns)) return json({ success: false, error: { code: 'INVALID_BODY', message: 'Add your email address and we will send the chat.' } }, 400);
  const firstName = typeof b.firstName === 'string' ? b.firstName.trim().slice(0, 40) || null : null;
  const r = await emailTranscript({ email, firstName, requestId: randomUUID().replace(/-/g, ''), turns: b.turns.slice(-40) });
  if (r.ok) return json({ success: true }, 200);
  return json({ success: false, error: { code: r.code, message: r.message } }, r.code === 'DAILY_CAP' ? 429 : r.status >= 500 ? 503 : 400);
};
