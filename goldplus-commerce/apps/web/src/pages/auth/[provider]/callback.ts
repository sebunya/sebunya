import type { APIRoute } from 'astro';
import { apiBase } from '../../../lib/api';
import { sessionCookieValue } from '../../../lib/session';

/**
 * Complete social sign-in (0106).
 *
 * Handles GET (Google, Facebook) and POST (Apple's form_post response mode).
 * The API verifies everything cryptographically; this route's only jobs are to
 * hand back the sealed flow, clear it so it cannot be replayed, and set the
 * session cookie on the storefront host.
 */

const FLOW_COOKIE = 'gp_oauth_flow';

const readFlowCookie = (request: Request): { sealedFlow: string; returnTo: string; provider: string } | null => {
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

const safeReturnTo = (value: string | undefined): string => {
  const candidate = (value ?? '/account').trim();
  return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : '/account';
};

const handle: APIRoute = async ({ params, request, url }) => {
  const provider = String(params.provider ?? '');
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  const clearFlow = `${FLOW_COOKIE}=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0`;

  const fail = (code: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `/login?social_error=${code}`, 'Set-Cookie': clearFlow },
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

  const flow = readFlowCookie(request);
  if (!flow || flow.provider !== provider) return fail('state');
  if (!code || !state) return fail('cancelled');

  try {
    const res = await fetch(`${apiBase}/auth/social/${encodeURIComponent(provider)}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state, sealedFlow: flow.sealedFlow }),
      signal: AbortSignal.timeout(12000),
    });
    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.success) {
      const errorCode = String(json?.error?.code ?? 'exchange').toLowerCase();
      return fail(errorCode);
    }

    const { token } = json.data as { token: string };
    const headers = new Headers({ Location: safeReturnTo(flow.returnTo) });
    // Clear the one-time flow AND set the session, on this host.
    headers.append('Set-Cookie', clearFlow);
    headers.append('Set-Cookie', sessionCookieValue(token));
    return new Response(null, { status: 303, headers });
  } catch {
    return fail('exchange');
  }
};

export const GET = handle;
export const POST = handle;
