import type { APIRoute } from 'astro';
import { summariseCspReports, CspViolationLog } from '../../lib/cspReports';

/**
 * Where browsers send what the report-only strict policy WOULD have blocked
 * (lib/contentSecurityPolicy.ts). Every page view can produce reports, so they
 * are reduced to a small key (directive + blocked origin + source path) and
 * logged once per key per hour with a running count: enough to decide whether
 * enforcing is safe, never a flood. Nothing is stored and no visitor detail is
 * kept (no address, no query strings).
 */
const MAX_BODY = 16 * 1024;
const log = new CspViolationLog({ windowMs: 60 * 60 * 1000, maxKeys: 500 });

export const POST: APIRoute = async ({ request }) => {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_BODY) return new Response(null, { status: 413 });
  const text = (await request.text().catch(() => '')).slice(0, MAX_BODY);
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
  for (const violation of summariseCspReports(body)) {
    const line = log.record(violation);
    if (line) console.warn('CSP_VIOLATION', JSON.stringify(line));
  }
  return new Response(null, { status: 204 });
};
