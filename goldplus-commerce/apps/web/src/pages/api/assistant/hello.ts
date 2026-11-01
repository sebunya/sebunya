import type { APIRoute } from 'astro';
import { isSignedVisitToken } from '../../../lib/visitToken';
import { assistantEnabled } from '../../../lib/assistant';
import { requestUserId } from '../../../lib/customerAuth';
import { shopperContext } from '../../../lib/assistantConversation';

/**
 * GET /api/assistant/hello: what Goldie's welcome may say to THIS visitor
 * (first name, returning or regular, what they were after last time). Read
 * when the panel first opens; per-visitor and never cached. Empty for a new
 * visitor, so the greeting simply stays general.
 */
export const prerender = false;

const none = { firstName: null, returning: false, regular: false, hasOrdered: false, lastInterest: null, recentlyViewed: null };

export const GET: APIRoute = async ({ cookies, locals }) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' };
  if (!assistantEnabled()) return new Response(JSON.stringify(none), { status: 200, headers });
  const visit = cookies.get('gp_visit')?.value;
  const fp = cookies.get('_fp_cid')?.value ?? '';
  const userId = await requestUserId(locals as { gpUserId?: string | null }, cookies).catch(() => null);
  const ctx = await shopperContext({ visitToken: isSignedVisitToken(visit) ? visit! : null, userId, fpClientId: /^[A-Za-z0-9._-]{8,200}$/.test(fp) ? fp : null }, 1200);
  if (!ctx) return new Response(JSON.stringify(none), { status: 200, headers });
  const body = {
    firstName: ctx.firstName,
    returning: ctx.visits >= 2,
    regular: ctx.visits >= 4 || ctx.hasOrdered,
    hasOrdered: ctx.hasOrdered,
    // What they asked Goldie about last, else the kind of thing they browse most.
    lastInterest: ctx.pastTopics[0] ?? ctx.topCategories[0] ?? null,
    recentlyViewed: ctx.recentlyViewed[0] ?? null,
  };
  return new Response(JSON.stringify(body), { status: 200, headers });
};
