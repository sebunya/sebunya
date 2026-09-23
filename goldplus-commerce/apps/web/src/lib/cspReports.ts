/**
 * Content-Security-Policy violation reports, reduced to what decides
 * "is it safe to enforce?": which directive, what was blocked (an origin or a
 * keyword such as `inline`), and which of our pages or files it came from.
 *
 * Two wire formats exist: the legacy `report-uri` body
 * ({"csp-report": {...}}, kebab-case) and the Reporting API
 * ([{type: "csp-violation", body: {...}}], camelCase). Both are accepted.
 * Query strings and fragments are dropped; nothing identifies a visitor.
 */

export interface CspViolation {
  directive: string;
  blocked: string;
  source: string;
  disposition: string;
}

export function summariseCspReports(input: unknown): CspViolation[] {
  const reports: Array<Record<string, unknown>> = [];
  if (Array.isArray(input)) {
    for (const r of input) {
      const rec = r as Record<string, unknown> | null;
      if (rec && rec.type === 'csp-violation' && rec.body && typeof rec.body === 'object') reports.push(rec.body as Record<string, unknown>);
    }
  } else if (input && typeof input === 'object' && (input as Record<string, unknown>)['csp-report']) {
    reports.push((input as Record<string, unknown>)['csp-report'] as Record<string, unknown>);
  }
  return reports.slice(0, 20).map((r) => ({
    directive: str(r['effective-directive'] ?? r.effectiveDirective ?? r['violated-directive'] ?? r.violatedDirective).split(' ')[0] || 'unknown',
    blocked: reduceUrl(str(r['blocked-uri'] ?? r.blockedURL)),
    source: reduceUrl(str(r['source-file'] ?? r.sourceFile ?? r['document-uri'] ?? r.documentURL), true),
    disposition: str(r.disposition) || 'report',
  }));
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, 500) : '';
}

/** `inline` / `eval` stay as they are; a URL becomes its origin, or origin + path when the path is ours to fix. */
function reduceUrl(value: string, keepPath = false): string {
  if (!value) return 'none';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return value.slice(0, 40);
  try {
    const u = new URL(value);
    if (u.protocol === 'data:' || u.protocol === 'blob:') return u.protocol;
    return keepPath ? `${u.origin}${u.pathname}`.slice(0, 200) : u.origin;
  } catch {
    return 'unparseable';
  }
}

/** Logs each distinct violation once per window, with how many times it was seen in the previous one. */
export class CspViolationLog {
  private readonly seen = new Map<string, { firstAt: number; count: number }>();

  constructor(private readonly opts: { windowMs: number; maxKeys: number; now?: () => number }) {}

  record(v: CspViolation): (CspViolation & { seenInWindow: number }) | null {
    const now = (this.opts.now ?? Date.now)();
    const key = `${v.directive}|${v.blocked}|${v.source}|${v.disposition}`;
    const entry = this.seen.get(key);
    if (entry && now - entry.firstAt < this.opts.windowMs) {
      entry.count += 1;
      return null;
    }
    const previous = entry?.count ?? 0;
    if (!entry && this.seen.size >= this.opts.maxKeys) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.delete(key);
    this.seen.set(key, { firstAt: now, count: 1 });
    return { ...v, seenInWindow: previous };
  }
}
