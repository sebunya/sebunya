import type { APIRoute } from 'astro';
import { apiBase } from '../../../lib/api';
import { sessionCookieValue } from '../../../lib/session';

/**
 * Google redirects the browser back here. We validate the CSRF state
 * against the cookie set in /auth/google, hand the code to the API for the
 * secret exchange, then set the session cookie and land the user in their
 * account. The access token never touches the browser.
 */
const STATE_COOKIE = 'gp_oauth_state';

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=').trim() || null;
  }
  return null;
}

const clearedState = `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

function fail(reason: string): Response {
  return new Response(null, { status: 303, headers: { Location: `/login?social=${reason}`, 'Set-Cookie': clearedState } });
}

export const GET: APIRoute = async ({ request, url }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const savedState = readCookie(request, STATE_COOKIE);

  if (url.searchParams.get('error')) return fail('declined');
  if (!code) return fail('missing_code');
  if (!state || !savedState || state !== savedState) return fail('bad_state');

  try {
    const res = await fetch(`${apiBase}/auth/google/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code }),
    });
    const json: any = await res.json().catch(() => null);

    if (!res.ok || !json?.success || !json.data?.token) {
      const reason = json?.error?.code === 'NOT_CONFIGURED' ? 'not_configured' : 'failed';
      return fail(reason);
    }

    // Two Set-Cookie headers: clear the transient state, set the session.
    const headers = new Headers({ Location: '/account' });
    headers.append('Set-Cookie', clearedState);
    headers.append('Set-Cookie', sessionCookieValue(json.data.token));
    return new Response(null, { status: 303, headers });
  } catch {
    return fail('unavailable');
  }
};
