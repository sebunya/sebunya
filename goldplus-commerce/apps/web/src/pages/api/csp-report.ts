import type { APIRoute } from 'astro';
import { summariseCspReports, CspViolationLog } from '../../lib/cspReports';

/**
 * Where browsers send what the report-only strict policy WOULD have blocked
 * (lib/contentSecurityPolicy.ts). Every page view can produce reports, so they
 * are reduced to a small key (directive + blocked origin + source path) and
 * logged once per key per hour with a running count, and at most 200 lines an
 * hour in total (the rest counted as suppressed): enough to decide whether
 * enforcing is safe, never a flood — the endpoint is public. Nothing is stored
 * and no visitor detail is kept (no address, no query strings).
 */
const MAX_BODY = 16 * 1024;
const log = new CspViolationLog({ windowMs: 60 * 60 * 1000, maxKeys: 500, maxLinesPerWindow: 200 });

export const POST: APIRoute = async ({ request }) => {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_BODY) return new Response(null, { status: 413 });
  const text = await readBounded(request, MAX_BODY);
  if (text === null) return new Response(null, { status: 413 });
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
  for (const violation of summariseCspReports(body)) {
    for (const line of log.record(violation)) {
      console.warn('suppressedInPreviousWindow' in line ? 'CSP_VIOLATION_SUPPRESSED' : 'CSP_VIOLATION', JSON.stringify(line));
    }
  }
  return new Response(null, { status: 204 });
};

/** The body as text, or null past `max` bytes — read in chunks, so an undeclared (chunked) upload cannot fill memory first. */
async function readBounded(request: Request, max: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
    if (done || !value) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => undefined); return null; }
    parts.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(parts));
}
