import type { APIRoute } from 'astro';
import { readSessionToken } from '../../../../lib/session';
import { advertisingApi } from '../../../../lib/adminAdvertising';

/** A LinkedIn contact-list file (hashed emails only), built by the API with the audience consent gate. */
export const GET: APIRoute = async ({ request, params }) => {
  const token = readSessionToken(request);
  if (!token) return new Response('Sign in first.', { status: 401 });
  const segment = String(params.segment ?? '');
  const r = await advertisingApi<{ csv: string }>(token, 'GET', `/audiences/linkedin-csv/${encodeURIComponent(segment)}`);
  if (!r.ok) return new Response(r.message, { status: 400 });
  if (typeof r.data?.csv !== 'string') return new Response('Could not build the list.', { status: 400 });
  return new Response(r.data.csv, { headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="goldplus-linkedin-${segment.replace(/[^a-z_]/g, '')}.csv"`,
    'Cache-Control': 'no-store',
  } });
};
