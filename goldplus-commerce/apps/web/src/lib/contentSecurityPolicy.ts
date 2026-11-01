/**
 * The strict script policy, observed before it is enforced.
 *
 * The ENFORCED policy is set by Caddy and still carries `'unsafe-inline'` in
 * script-src, which means an injected <script> would run. Removing it in one
 * step would block every inline script the site depends on: the GTM and
 * Clarity bootstraps, the font loader, Cloudflare's injected beacon and, while
 * it is switched on, Rocket Loader's loader. Checkout would break with it.
 *
 * So every HTML response carries a per-request nonce — written by templates on
 * the inline scripts they own, stamped here on our same-site script files —
 * and a nonce-based policy in `Content-Security-Policy-Report-Only`. Browsers enforce
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

/**
 * Adds nonce="…" to <script> start tags that load a SAME-SITE FILE
 * (src="/…", our own bundles) and have no nonce yet. Inline scripts are never
 * touched: a template that owns one writes nonce={Astro.locals.cspNonce}
 * itself. Stamping every <script> would hand the nonce to a script an attacker
 * managed to inject into the page — the very thing the policy exists to stop.
 */
export function nonceScriptTags(html: string, nonce: string): string {
  return html.replace(/<script(?=[\s>])([^>]*)>/gi, (tag, attrs: string) => {
    if (/\snonce\s*=/i.test(attrs)) return tag;
    const src = /\ssrc\s*=\s*(["'])([^"']*)\1/i.exec(attrs)?.[2];
    if (!src || !src.startsWith('/') || src.startsWith('//')) return tag;
    return `<script nonce="${nonce}"${attrs}>`;
  });
}

/**
 * The same, as a stream, so the page still streams to the browser. A start tag
 * split across chunks ("…<scr" | "ipt src=…>") is held back until its closing
 * ">" arrives.
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

/** Start of an unfinished script start tag (or of a possible "<script" prefix) at the end of `text`; text.length when there is none. */
function heldTailStart(text: string): number {
  const open = text.toLowerCase().lastIndexOf(OPEN);
  // A complete "<script" whose tag has not closed yet: hold from it (bounded, so a stray one cannot stall the stream).
  if (open !== -1 && text.indexOf('>', open) === -1 && text.length - open < 4096) return open;
  const at = text.lastIndexOf('<');
  if (at === -1 || text.length - at > OPEN.length) return text.length;
  return OPEN.startsWith(text.slice(at).toLowerCase()) ? at : text.length;
}
