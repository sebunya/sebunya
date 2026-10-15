import { safeReturnTo } from '../../../lib/safeReturnTo';
import type { APIRoute } from 'astro';
import { apiBase } from '../../../lib/api';
import { readSessionToken, signInCookieHeaders } from '../../../lib/session';
import { SIGNED_UP_COOKIE } from '../../../lib/siteSignalRules';

/**
 * Complete social sign-in (0106).
 *
 * Handles GET: Google and Facebook return here directly, and Apple's form POST reaches it as a GET through the API
 * relay (POST /auth/social/apple/form-post). POST is still accepted for a direct form post.
 *
 * A flow started from Account → Sign-in methods (intent "link") connects the provider to the signed-in account:
 * the session goes with the exchange, no new session is set, and the customer returns to that page.
 * The API verifies everything cryptographically; this route's only jobs are to
 * hand back the sealed flow, clear it so it cannot be replayed, and set the
 * session cookie on the storefront host.
 */

const FLOW_COOKIE = 'gp_oauth_flow';

const LINK_PAGE = '/account/sign-in';

const readFlowCookie = (request: Request): { sealedFlow: string; returnTo: string; provider: string; intent?: string } | null => {
  const header = request.headers.get('cookie') ?? '';
  const raw = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${FLOW_COOKIE}=`))
    ?.slice(FLOW_COOKIE.length + 1);
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
};


const handle: APIRoute = async ({ params, request, url }) => {
  const provider = String(params.provider ?? '');
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  const clearFlow = `${FLOW_COOKIE}=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0`;

  const flow = readFlowCookie(request);
  const link = flow?.intent === 'link';
  const fail = (code: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `${link ? LINK_PAGE : '/login'}?social_error=${encodeURIComponent(code)}`, 'Set-Cookie': clearFlow },
    });

  let code: string | null = null;
  let state: string | null = null;
  if (request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    code = form ? String(form.get('code') ?? '') || null : null;
    state = form ? String(form.get('state') ?? '') || null : null;
  } else {
    code = url.searchParams.get('code');
    state = url.searchParams.get('state');
  }

  if (!flow || flow.provider !== provider) return fail('state');
  if (!code || !state) return fail('cancelled');

  try {
    const token = link ? readSessionToken(request) : null;
    if (link && !token) return fail('unauthenticated');
    const res = await fetch(`${apiBase}/auth/social/${encodeURIComponent(provider)}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ code, state, sealedFlow: flow.sealedFlow }),
      signal: AbortSignal.timeout(12000),
    });
    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.success) {
      const errorCode = String(json?.error?.code ?? 'exchange').toLowerCase();
      return fail(errorCode);
    }

    if (link) {
      return new Response(null, {
        status: 303,
        headers: { Location: `${LINK_PAGE}?connected=${encodeURIComponent(provider)}`, 'Set-Cookie': clearFlow },
      });
    }

    const { created } = json.data as { token: string; created?: boolean };
    const headers = new Headers({ Location: safeReturnTo(flow.returnTo) });
    // Clear the one-time flow AND set the session, on this host.
    headers.append('Set-Cookie', clearFlow);
    for (const cookie of signInCookieHeaders(json.data)) headers.append('Set-Cookie', cookie); // short token + refresh credential
    // A first sign-in with Google or Apple IS a new account: the same marker
    // the register page sets, so it is reported as one sign_up (lib/siteSignals).
    if (created === true) headers.append('Set-Cookie', `${SIGNED_UP_COOKIE}=1; Path=/${secure}; SameSite=Lax; Max-Age=300`);
    return new Response(null, { status: 303, headers });
  } catch {
    return fail('exchange');
  }
};

export const GET = handle;
export const POST = handle;
