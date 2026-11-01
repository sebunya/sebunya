import type { APIRoute } from 'astro';
import { apiBase } from '../../lib/api';
import { apiHeaders } from '../../lib/forwardClient';
import { readSessionToken } from '../../lib/session';
import { checkRequestOrigin } from '../../lib/requestOrigin';
import { safeReturnTo } from '../../lib/safeReturnTo';
import { forgetInvite, setInviteNote } from '../../lib/referralInvite';

/**
 * "A friend invited you? Add their code" on the invite card (2026-10-22): for a customer who signed up on another
 * device, with Google or Facebook, or forgot. The API decides (new customers only, never their own code); the next
 * page says what happened, once.
 */
export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData().catch(() => null);
  const back = `${safeReturnTo(String(form?.get('returnTo') ?? ''), '/account/rewards')}#refer`;
  const token = readSessionToken(request);
  if (!token) return redirect('/login?returnTo=/account/rewards', 303);
  if (!checkRequestOrigin(request, import.meta.env as unknown as Record<string, string | undefined>).allowed) return redirect(back, 303);
  try {
    const res = await fetch(`${apiBase}/account/referral/code`, {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` }, null),
      body: JSON.stringify({ code: String(form?.get('code') ?? '').slice(0, 20), source: 'account' }),
      signal: AbortSignal.timeout(5000),
    });
    const json: any = await res.json().catch(() => null);
    setInviteNote(cookies, json?.success ? 'applied' : String(json?.error?.code ?? 'CODE_NOT_FOUND'), import.meta.env.PROD);
    if (json?.success) forgetInvite(cookies);
  } catch {
    setInviteNote(cookies, 'UNAVAILABLE', import.meta.env.PROD);
  }
  return redirect(back, 303);
};
