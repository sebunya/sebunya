import type { APIRoute } from 'astro';
import { apiBase } from '../../lib/api';

/**
 * Starts the Google OAuth flow. The web app owns the CSRF state (stored in
 * an HttpOnly cookie on its own origin, so the callback on this same origin
 * can read it back) and asks the API only to build the authorization URL.
 */
const STATE_COOKIE = 'gp_oauth_state';

function stateCookie(value: string, maxAge: number): string {
  const isProd = import.meta.env.PROD;
  const attrs = [`${STATE_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isProd) attrs.push('Secure');
  return attrs.join('; ');
}

export const GET: APIRoute = async () => {
  const state = crypto.randomUUID().replace(/-/g, '');

  try {
    const res = await fetch(`${apiBase}/auth/google/url?state=${encodeURIComponent(state)}`, {
      headers: { Accept: 'application/json' },
    });
    const json: any = await res.json().catch(() => null);

    if (!res.ok || !json?.success || !json.data?.url) {
      const reason = json?.error?.code === 'NOT_CONFIGURED' ? 'not_configured' : 'unavailable';
      return new Response(null, { status: 303, headers: { Location: `/login?social=${reason}` } });
    }

    return new Response(null, {
      status: 303,
      headers: { Location: json.data.url, 'Set-Cookie': stateCookie(state, 600) },
    });
  } catch {
    return new Response(null, { status: 303, headers: { Location: '/login?social=unavailable' } });
  }
};
