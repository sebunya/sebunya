/**
 * A small per-visitor budget for the public forms the storefront posts to the
 * API server side.
 *
 * WHY THIS EXISTS
 * The dealer application, quote request, support and fake-report forms (and
 * the order lookup) are POSTed to this Astro server, which then calls the API
 * from the web container. The API's per-family rate limits key on the client
 * address in X-Forwarded-For; a server-side call carries none, so the API
 * reads it as our own service and skips every budget. Each accepted form also
 * texts the phone typed on it, so the forms were an unthrottled "SMS any
 * Ugandan number" primitive on the credit that carries OTPs and paid-order
 * alerts. (The API now also sends at most one acknowledgement per recipient
 * per hour.)
 *
 * In-process and approximate by design: it is defence in depth for a small
 * shop, not an accounting system. Budgets are generous because Ugandan mobile
 * carriers put many people behind one address (CGNAT).
 */

export interface FormBudget {
  /** Submissions allowed per window, per visitor, per form. */
  limit: number;
  windowMs: number;
}

const TEN_MINUTES = 10 * 60_000;

/** The forms that are budgeted; every other path is untouched. */
export const PUBLIC_FORM_BUDGETS: Readonly<Record<string, FormBudget>> = {
  '/dealers/apply': { limit: 5, windowMs: TEN_MINUTES },
  '/quote-request': { limit: 5, windowMs: TEN_MINUTES },
  '/support/issue': { limit: 5, windowMs: TEN_MINUTES },
  '/support/fake': { limit: 5, windowMs: TEN_MINUTES },
  '/track-order': { limit: 20, windowMs: TEN_MINUTES },
};

/** Trailing slash and case are not a way around the budget. */
export function budgetedFormPath(pathname: string): string | null {
  const normalised = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  return Object.prototype.hasOwnProperty.call(PUBLIC_FORM_BUDGETS, normalised) ? normalised : null;
}

/**
 * The visitor's address. Caddy's X-Real-IP first: the storefront proxy always
 * overwrites it with `{client_ip}`, which trusts CF-Connecting-IP only from
 * Cloudflare's ranges. A raw CF-Connecting-IP is NOT read: the storefront proxy
 * forwards it untouched, so anyone reaching the origin directly could send a
 * fresh value on every POST and never meet the budget. Otherwise what Astro
 * reports (the socket peer).
 */
export function visitorKey(headers: Headers, clientAddress: () => string | undefined): string {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  try {
    return clientAddress()?.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export class PublicFormLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly budgets: Readonly<Record<string, FormBudget>> = PUBLIC_FORM_BUDGETS,
    /** A hard ceiling on remembered keys so a spray of addresses cannot grow memory without bound. */
    private readonly maxKeys = 20_000,
  ) {}

  /** Records the attempt and says whether it is within budget. */
  allow(path: string, visitor: string, now: number = Date.now()): boolean {
    const budget = this.budgets[path];
    if (!budget) return true;
    const key = `${path}|${visitor}`;
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < budget.windowMs);
    if (recent.length >= budget.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.delete(key); // re-insert so Map order tracks recency
    this.hits.set(key, recent);
    while (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest === undefined) break;
      this.hits.delete(oldest);
    }
    return true;
  }
}

/** A plain, honest refusal for a form POST over budget. */
export function tooManySubmissionsResponse(): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Please wait a moment</title><meta name="robots" content="noindex"></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.25rem">Please wait a few minutes</h1><p>We have received several submissions from your connection in a short time. Please wait a few minutes, then go back and try again.</p><p><a href="/">Back to GoldPlus</a></p></body></html>`;
  return new Response(body, {
    status: 429,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '600', 'Cache-Control': 'no-store' },
  });
}
