import type { APIRoute } from 'astro';
import { apiBase } from '../../../lib/api';
import { readSessionToken } from '../../../lib/session';

/**
 * Gift card and store credit movements for a period, for the accountant (a card is money the shop owes until it is
 * spent). Text cells that a spreadsheet would run as a formula are neutralised (CSV injection).
 */
const MOVEMENT: Record<string, string> = { ISSUE: 'Issued', RETURN: 'Given back', ADJUST: 'Correction', VOID: 'Cancelled' };
const HOLD: Record<string, string> = { held: 'Reserved by an unpaid order', captured: 'Spent on an order', released: 'Reserved then released' };
const cell = (v: unknown) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const GET: APIRoute = async ({ request, url }) => {
  const token = readSessionToken(request);
  if (!token) return new Response('Sign in first.', { status: 401 });
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const res = await fetch(`${apiBase}/admin/credit/ledger?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  const json: any = res ? await res.json().catch(() => null) : null;
  if (!res?.ok || !json?.success) return new Response(json?.error?.message ?? 'Could not build the file.', { status: res?.status === 403 ? 403 : 400 });
  const lines = [['Date (Kampala)', 'Card', 'Movement', 'Amount (UGX)', 'Order', 'Note'].join(',')];
  for (const r of json.data as any[]) {
    const when = new Date(r.createdAt).toLocaleString('en-GB', { timeZone: 'Africa/Kampala', dateStyle: 'short', timeStyle: 'short' });
    const card = `${r.kind === 'gift_card' ? 'Gift card' : 'Store credit'} ****${r.last4}`;
    const movement = r.type === 'HOLD' ? HOLD[r.holdState] ?? 'Order' : MOVEMENT[r.type] ?? r.type;
    // A released hold changed nothing; it is listed (with 0) so every row of the card's history is accounted for.
    const amount = r.type === 'HOLD' && r.holdState === 'released' ? 0 : Number(r.amountUgx);
    lines.push([cell(when), cell(card), cell(movement), String(amount), cell(r.orderNumber ?? ''), cell(r.note ?? '')].join(','));
  }
  return new Response(lines.join('\r\n') + '\r\n', { headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="goldplus-gift-cards-${from.replace(/[^0-9-]/g, '')}-to-${to.replace(/[^0-9-]/g, '')}.csv"`,
    'Cache-Control': 'no-store',
  } });
};
