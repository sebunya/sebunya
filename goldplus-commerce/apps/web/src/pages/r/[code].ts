import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import { apiBase } from '../../lib/api';
import { jsonApiHeaders } from '../../lib/forwardClient';
import { INVITE_DAYS, INVITE_VISITOR_COOKIE, isLinkPreviewAgent, normaliseInviteCode, rememberInvite } from '../../lib/referralInvite';

/**
 * A customer's invite link: /r/<code>?via=whatsapp (2026-10-22). Remembers the code in this browser (60 days), counts
 * the open (people, not link previews), and lands the friend on the welcome page tagged as a friend's invite, so the
 * visit is reported as "Invited by a customer" instead of direct.
 */
export const GET: APIRoute = async ({ params, url, cookies, request, redirect }) => {
  const code = normaliseInviteCode(params.code);
  if (!code) return redirect('/', 302);
  const via = /^(whatsapp|sms|share|copy|link)$/.test(url.searchParams.get('via') ?? '') ? url.searchParams.get('via')! : 'link';
  const secure = import.meta.env.PROD;
  if (!isLinkPreviewAgent(request.headers.get('user-agent'))) {
    rememberInvite(cookies, code, secure);
    let visitor = cookies.get(INVITE_VISITOR_COOKIE)?.value ?? '';
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(visitor)) {
      visitor = randomBytes(18).toString('base64url');
      cookies.set(INVITE_VISITOR_COOKIE, visitor, { path: '/', maxAge: 60 * 60 * 24 * INVITE_DAYS, sameSite: 'lax', httpOnly: true, secure });
    }
    try {
      await fetch(`${apiBase}/referrals/visit`, {
        method: 'POST', headers: jsonApiHeaders(null), body: JSON.stringify({ code, visitorKey: visitor, via }), signal: AbortSignal.timeout(1500),
      });
    } catch {
      /* the count is a measure, never a condition of the welcome */
    }
  }
  const to = new URLSearchParams({ code, utm_source: 'customer_invite', utm_medium: 'friend', utm_campaign: 'refer_a_friend', utm_content: via });
  return redirect(`/invite?${to.toString()}`, 302);
};
