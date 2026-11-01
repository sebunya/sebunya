/**
 * "Advertising on this device" for every visitor, signed in or not (2026-10-17).
 *
 * Off means two things, both of which the visitor is told:
 *  - the browser: the gp_ads=0 cookie, which BaseLayout reads before Google's tag loads, so Google is never given
 *    advertising signals (retargeting, ad cookies) from this device;
 *  - the server: an advertising withdrawal recorded against this device's visitor id (`_fp_cid`) through the
 *    existing /consent/withdraw route. The ad senders re-check that record right before every send
 *    (AdvertisingConsentGate), so purchases, product views and customer lists stop going to ad platforms.
 * On records an explicit grant for advertising and keeps the visitor's other choices as they are.
 * A signed-in visitor's session goes along, so the choice is also the account's.
 */
export type DeviceAdResult = { ok: true } | { ok: false; message: string };

const VISITOR_ID = /^[A-Za-z0-9._:-]{8,255}$/;

export async function setDeviceAdvertising(on: boolean, ctx: { apiBase: string; fpClientId: string | undefined; sessionToken: string | null; fetchImpl?: typeof fetch }): Promise<DeviceAdResult> {
  const fp = ctx.fpClientId ?? '';
  if (!VISITOR_ID.test(fp)) return { ok: false, message: 'This browser has no visitor id yet (cookies may be blocked). Reload the page and try again.' };
  const failed: DeviceAdResult = { ok: false, message: 'Your choice could not be saved. Nothing changed; please try again.' };
  try {
    // The DEVICE first, always (no session: the API then keys the record on the visitor id), so the choice holds
    // when this person browses signed out; then the ACCOUNT too when signed in (the API keys it on the user).
    if (!(await record(on, fp, null, ctx.apiBase, ctx.fetchImpl ?? fetch))) return failed;
    if (ctx.sessionToken && !(await record(on, fp, ctx.sessionToken, ctx.apiBase, ctx.fetchImpl ?? fetch))) return failed;
    return { ok: true };
  } catch {
    return { ok: false, message: 'Your choice could not be saved right now. Nothing changed; please try again.' };
  }
}

async function record(on: boolean, fp: string, token: string | null, apiBase: string, f: typeof fetch): Promise<boolean> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!on) {
    const r = await f(`${apiBase}/consent/withdraw`, { method: 'POST', headers, body: JSON.stringify({ fp_client_id: fp, purposes: ['advertising'], reason: 'Turned off on the cookies page' }), signal: AbortSignal.timeout(5000) });
    return r.ok;
  }
  // On: an explicit advertising grant that keeps the other choices as they are now.
  const s = await f(`${apiBase}/consent/status?fp_client_id=${encodeURIComponent(fp)}`, { headers, signal: AbortSignal.timeout(5000) });
  const cur = s.ok ? ((await s.json().catch(() => null))?.data ?? null) : null;
  if (!cur) return false;
  const r = await f(`${apiBase}/consent/signal`, {
    method: 'POST', headers, signal: AbortSignal.timeout(5000),
    body: JSON.stringify({
      fp_client_id: fp, grant_type: 'explicit', capture_surface: 'privacy_settings', consent_at: Math.floor(Date.now() / 1000),
      purposes: { essential: true, analytics: cur.analytics === true, personalization: cur.personalization === true, advertising: true },
    }),
  });
  return r.ok;
}
