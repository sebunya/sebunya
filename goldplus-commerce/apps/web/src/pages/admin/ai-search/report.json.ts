import type { APIRoute } from 'astro';
import { readSessionToken } from '../../../lib/session';
import { aivGet, DEFAULT_PROJECT } from '../../../lib/adminAiVisibility';

/**
 * Machine-readable AI Search report: the exact object the report page renders,
 * downloaded with the operator's session (the browser never needs an API
 * token). Never cached: it is private operating data.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const token = readSessionToken(request);
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (!token) return new Response(JSON.stringify({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in to admin first.' } }), { status: 401, headers });
  const project = url.searchParams.get('project') ?? DEFAULT_PROJECT;
  const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 28) || 28, 1), 365);
  const r = await aivGet<unknown>(token, `/projects/${encodeURIComponent(project)}/report?days=${days}`);
  if (!r.ok) return new Response(JSON.stringify({ success: false, error: { code: r.code, message: r.message } }), { status: r.status || 502, headers });
  return new Response(JSON.stringify(r.data, null, 2), {
    status: 200,
    headers: { ...headers, 'Content-Disposition': `attachment; filename="ai-search-report-${project}-${new Date().toISOString().slice(0, 10)}.json"` },
  });
};
