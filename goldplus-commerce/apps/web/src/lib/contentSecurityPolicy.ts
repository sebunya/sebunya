/**
 * The strict script policy, observed before it is enforced.
 *
 * The ENFORCED policy is set by Caddy and still carries `'unsafe-inline'` in
 * script-src, which means an injected <script> would run. Removing it in one
 * step would block every inline script the site depends on: the GTM and
 * Clarity bootstraps, the font loader, Cloudflare's injected beacon and, while
 * it is switched on, Rocket Loader's loader. Checkout would break with it.
 *
 * So every HTML response carries a per-request nonce on each <script> tag and a
 * nonce-based policy in `Content-Security-Policy-Report-Only`. Browsers enforce
 * nothing from it; they report what it WOULD block to /api/csp-report. When the
 * reports are quiet, CSP_STRICT_MODE=enforce sends it as an enforced policy
 * (docs/hardening/strict-csp.md).
 *
 * Shape follows the published "strict CSP" recipe: 'strict-dynamic' lets a
 * nonced script load what it needs (GTM → tags), and the https:/'unsafe-inline'
 * entries are ignored by every browser that understands nonces — they only
 * keep very old browsers working.
 */

export const CSP_REPORT_PATH = '/api/csp-report';

export type StrictPolicyMode = 'report' | 'enforce' | 'off';

/** Anything but an exact 'enforce' or 'off' is 'report': a typo must never start blocking scripts. */
export function strictPolicyMode(value: string | undefined): StrictPolicyMode {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'enforce' || v === 'off' ? v : 'report';
}

export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function strictReportOnlyPolicy(nonce: string): string {
  return [
    `script-src 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `report-uri ${CSP_REPORT_PATH}`,
  ].join('; ');
}

const OPEN = '<script';

/** Adds nonce="…" to every <script …> start tag in one piece of HTML. */
export function nonceScriptTags(html: string, nonce: string): string {
  return html.replace(/<script(?=[\s>])/gi, `<script nonce="${nonce}"`);
}

/**
 * The same, as a stream, so the page still streams to the browser. A tag split
 * across two chunks ("…<scr" | "ipt src=…") is held back until the next chunk
 * completes it.
 */
export function nonceScriptStream(nonce: string): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let carry = '';
  return new TransformStream({
    transform(chunk, controller) {
      const text = carry + decoder.decode(chunk, { stream: true });
      const cut = heldTailStart(text);
      carry = text.slice(cut);
      const ready = text.slice(0, cut);
      if (ready) controller.enqueue(encoder.encode(nonceScriptTags(ready, nonce)));
    },
    flush(controller) {
      const rest = carry + decoder.decode();
      if (rest) controller.enqueue(encoder.encode(nonceScriptTags(rest, nonce)));
    },
  });
}

/** Where a possibly-unfinished "<script" starts at the end of `text` (or text.length when there is none). */
function heldTailStart(text: string): number {
  const at = text.lastIndexOf('<', text.length - 1);
  if (at === -1 || text.length - at > OPEN.length) return text.length;
  const tail = text.slice(at).toLowerCase();
  // "<script" itself is held too: whether it is a tag depends on the next character.
  return OPEN.startsWith(tail) ? at : text.length;
}
