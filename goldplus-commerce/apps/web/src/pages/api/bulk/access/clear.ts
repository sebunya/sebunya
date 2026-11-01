import type { APIRoute } from 'astro';
import { checkRequestOrigin, CROSS_SITE_MESSAGE } from '../../../../lib/requestOrigin';
import { BULK_ACCESS_COOKIE } from '../../../../lib/bulkAccess';

/** "Not your number?": forgets the verified phone on this device. */
export const POST: APIRoute = async ({ request, cookies }) => {
  const origin = checkRequestOrigin(request, import.meta.env as unknown as Record<string, string | undefined>);
  if (!origin.allowed) {
    return new Response(JSON.stringify({ success: false, error: { code: 'CROSS_SITE', message: CROSS_SITE_MESSAGE } }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  cookies.delete(BULK_ACCESS_COOKIE, { path: '/' });
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
};
