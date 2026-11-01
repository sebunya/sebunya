import type { APIRoute } from 'astro';
import { readSessionToken } from '../../../../../lib/session';
import { apiBase } from '../../../../../lib/api';

/**
 * POST target of the "Where this order came from" panel (OrderSourcePanel).
 * Forwards the answer and WhatsApp reference to the API with the admin's
 * bearer (orders.manage, audited there) and returns to the order page with the
 * outcome in the query string. Nothing is recorded here.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: APIRoute = async ({ request, params, redirect }) => {
  const id = String(params.id ?? '');
  const token = readSessionToken(request);
  if (!token) return redirect(`/admin/login?returnTo=${encodeURIComponent(`/admin/orders/${id}`)}`, 303);
  if (!UUID.test(id)) return redirect('/admin/orders', 303);
  const back = (status: 'ok' | 'error', message: string) =>
    redirect(`/admin/orders/${id}?source=${status}&sourceMessage=${encodeURIComponent(message.slice(0, 200))}#order-source-h`, 303);
  let form: FormData;
  try { form = await request.formData(); } catch { return back('error', 'The form could not be read.'); }
  const field = (k: string) => String(form.get(k) ?? '').trim();
  const body = { answer: field('answer').slice(0, 40), whatsappRef: field('whatsappRef').slice(0, 40), note: field('note').slice(0, 300) };
  try {
    const res = await fetch(`${apiBase}/admin/attribution/orders/${encodeURIComponent(id)}/source`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success) {
      const n = Number(json.data?.linkedTouches ?? 0);
      return back('ok', json.data?.whatsappRef
        ? `Recorded. ${json.data.whatsappRef} linked ${n} recorded visit${n === 1 ? '' : 's'} to this order.`
        : 'Recorded.');
    }
    if (res.status === 403) return back('error', 'Your account cannot change orders.');
    return back('error', json?.error?.message ?? 'Not recorded. Try again, or check the order page.');
  } catch {
    return back('error', 'The API did not answer. Nothing was recorded.');
  }
};
