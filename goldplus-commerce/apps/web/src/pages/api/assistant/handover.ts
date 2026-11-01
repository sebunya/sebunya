import type { APIRoute } from 'astro';
import { readBodyCapped } from '../../../lib/boundedBody';
import { requestUserId } from '../../../lib/customerAuth';
import { handOver } from '../../../lib/assistantConversation';

/**
 * POST /api/assistant/handover: the shopper asks Goldie to pass the chat to
 * the team. Body: { name?, phone?, email?, note?, sendCopy?, turns }. The API
 * opens a support ticket (/admin/support) and emails the shop; with an email,
 * the shop's Reply goes straight to the customer and they get their own copy.
 * Budgeted per visitor in the middleware (publicFormLimiter).
 */
export const prerender = false;

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '') || null;

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const read = await readBodyCapped(request, 64 * 1024);
  if (!read.ok) return json({ success: false, error: { code: 'TOO_LARGE', message: 'That conversation is too long to send.' } }, 413);
  let b: Record<string, unknown> | null = null;
  try { b = JSON.parse(read.text); } catch { b = null; }
  if (!b || !Array.isArray(b.turns)) return json({ success: false, error: { code: 'INVALID_BODY', message: 'There is no conversation to pass on yet.' } }, 400);
  let page: string | null = null;
  try { const u = new URL(request.headers.get('referer') ?? ''); if (u.origin === new URL(request.url).origin) page = u.pathname; } catch { page = null; }
  const userId = await requestUserId(locals as { gpUserId?: string | null }, cookies).catch(() => null);
  const conversationId = typeof b.conversationId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.conversationId) ? b.conversationId : null;
  const r = await handOver({ userId, conversationId, name: str(b.name, 80), phone: str(b.phone, 30), email: str(b.email, 200), note: str(b.note, 500), page, sendCopy: b.sendCopy !== false, turns: b.turns.slice(-40) });
  if (r.ok) return json({ success: true, data: { copySent: r.data.copySent } }, 200);
  return json({ success: false, error: { code: r.code, message: r.message } }, r.status >= 500 ? 503 : 400);
};
