/**
 * GA4's own session for this browser, read from its `_ga_<stream>` cookie.
 * Two formats exist: GS1.1.<session id>.<session number>.… and the newer
 * GS2.1.s<session id>$o<session number>$…. Anything else yields nothing.
 */
export function gaSessionFromCookieHeader(cookieHeader: string | null | undefined): { gaSessionId: string; gaSessionNumber: number } | null {
  const raw = (cookieHeader ?? '').match(/(?:^|;\s*)_ga_[A-Z0-9]+=([^;]+)/)?.[1] ?? '';
  const m = raw.match(/^GS1\.\d\.(\d{1,20})\.(\d{1,7})/) ?? raw.match(/^GS2\.\d\.s(\d{1,20})\$o(\d{1,7})/);
  return m ? { gaSessionId: m[1], gaSessionNumber: Number(m[2]) } : null;
}
