import { safeReturnTo } from '../../../lib/safeReturnTo';
import type { APIRoute } from 'astro';
import { apiBase } from '../../../lib/api';

/**
 * Begin social sign-in (0106).
 *
 * The browser-facing half runs HERE, on the storefront host, because that is
 * the only host whose cookies the storefront can read. The API mints and seals
 * the flow (state, nonce, PKCE verifier); this route parks the sealed blob in
 * a short-lived HttpOnly cookie and sends the customer to the provider.
 *
 * The seal is opaque to the browser and MAC'd with a server secret, so nothing
 * here can be forged client-side.
 */

const FLOW_COOKIE = 'gp_oauth_flow';
const FLOW_TTL_SECONDS = 600;

export const GET: APIRoute = async ({ params, url, request }) => {
  const provider = String(params.provider ?? '');
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'));
  const secure = url.protocol === 'https:' ? '; Secure' : '';

  try {
    const res = await fetch(`${apiBase}/auth/social/${encodeURIComponent(provider)}/authorize-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(6000),
    });
    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.success) {
      const code = json?.error?.code === 'NOT_CONFIGURED' ? 'not_configured' : 'start';
      return new Response(null, { status: 303, headers: { Location: `/login?social_error=${code}` } });
    }

    const { authorizationUrl, sealedFlow } = json.data as { authorizationUrl: string; sealedFlow: string };
    // returnTo travels with the flow cookie, not the provider round-trip, so a
    // provider cannot influence where the customer lands afterwards.
    const cookieValue = encodeURIComponent(JSON.stringify({ sealedFlow, returnTo, provider }));

    return new Response(null, {
      status: 303,
      headers: {
        Location: authorizationUrl,
        'Set-Cookie': `${FLOW_COOKIE}=${cookieValue}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${FLOW_TTL_SECONDS}`,
      },
    });
  } catch {
    return new Response(null, { status: 303, headers: { Location: '/login?social_error=start' } });
  }
};
