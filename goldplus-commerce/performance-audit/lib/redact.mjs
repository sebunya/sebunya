// Secret redaction for logs and saved provider responses. Applied before any
// raw response is written to disk and to every log line the harness emits.
const KEY_PATTERNS = [
  /(api[_-]?key|apikey|token|secret|password|passwd|authorization|auth|cookie|set-cookie|x-api-key|loaderio-auth|session)/i,
];
const VALUE_PATTERNS = [
  /\b[A-Za-z0-9_-]{32,}\b/g,                // long opaque tokens
  /(key|token|k|apikey|api_key)=([^&\s"']{8,})/gi, // query-string credentials
  /Bearer\s+[A-Za-z0-9._-]{10,}/g,
  /Basic\s+[A-Za-z0-9+/=]{10,}/g,
];

const KNOWN = new Set();
/** Register literal secret values so they are always masked wherever they appear. */
export function registerSecret(value) { if (value && String(value).length >= 6) KNOWN.add(String(value)); }

export function redactText(text) {
  let s = String(text ?? '');
  for (const v of KNOWN) s = s.split(v).join('[REDACTED]');
  s = s.replace(VALUE_PATTERNS[1], '$1=[REDACTED]').replace(VALUE_PATTERNS[2], 'Bearer [REDACTED]').replace(VALUE_PATTERNS[3], 'Basic [REDACTED]');
  return s;
}

/** Deep-redact an object: secret-looking keys are masked; string values are scrubbed. */
export function redactObject(value, depth = 0) {
  if (depth > 40) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.map((v) => redactObject(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = KEY_PATTERNS.some((p) => p.test(k)) ? (v === null || v === undefined || v === '' ? v : '[REDACTED]') : redactObject(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return redactText(value);
  return value;
}

/** True when a serialised payload still looks like it carries a credential (used as a final guard before writing). */
export function looksLikeItHasSecrets(serialised) {
  const s = String(serialised);
  for (const v of KNOWN) if (s.includes(v)) return true;
  return /"(api[_-]?key|token|secret|password|authorization)"\s*:\s*"[^"\[]{6,}"/i.test(s);
}
