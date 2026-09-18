/**
 * Admin fetch helpers for the Organic Growth OS (/admin/seo/**).
 *
 * The API for this module may land after the pages do, so every helper returns
 * an HONEST result object instead of throwing: `notFound` when an endpoint is
 * not mounted yet (404), `denied` on 401/403, `error` with the API's own
 * message otherwise. Pages render zero-states from these — nothing is ever
 * fabricated.
 */
import { apiBase } from "./api";

/**
 * Most SEO endpoints return raw database rows (snake_case: started_at,
 * pages_crawled, http_status) while these pages were written against
 * camelCase (startedAt, pagesCrawled, statusCode). Every such field rendered
 * "—" and the module read as empty although the data existed (found
 * 2026-09-18). Each object gains the camelCase alias of every snake_case key;
 * the original key stays, so pages already reading snake_case keep working.
 */
const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
const ALIASES: Record<string, string> = { httpStatus: "statusCode" };
export function withCamelAliases(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withCamelAliases);
  if (!v || typeof v !== "object" || v instanceof Date) return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = withCamelAliases(val);
  for (const k of Object.keys(out)) {
    if (!k.includes("_")) continue;
    const c = camel(k);
    if (!(c in out)) out[c] = out[k];
    const alias = ALIASES[c];
    if (alias && !(alias in out)) out[alias] = out[k];
  }
  return out;
}

export type SeoResult<T> =
  | { ok: true; data: T }
  /** `details` carries the API's structured error payload (e.g. robots.txt
   *  validation findings with line numbers). Without it the operator saw a
   *  one-line message and an empty findings list. */
  | { ok: false; notFound?: boolean; denied?: boolean; message: string; details?: Record<string, unknown> };

async function request<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<SeoResult<T>> {
  try {
    const res = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const json = await res.json().catch(() => null);
    if (res.status === 404) {
      // A 404 here means the endpoint did not match — a deployment or routing
      // problem, not an unbuilt feature. The old wording ("not available yet")
      // told operators to wait for something that already exists.
      return { ok: false, notFound: true, message: "This endpoint did not respond. It may not be available on the currently deployed API version." };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, denied: true, message: "Your account does not carry the permission for this SEO module." };
    }
    if (!res.ok || !json?.success) {
      return {
        ok: false,
        message: json?.error?.message ?? `The API declined the request (HTTP ${res.status}).`,
        details: json?.error ?? undefined,
      };
    }
    return { ok: true, data: withCamelAliases(json.data) as T };
  } catch {
    return { ok: false, message: "Could not reach the API." };
  }
}

export function seoGet<T = unknown>(token: string, path: string): Promise<SeoResult<T>> {
  return request<T>(token, path);
}

export function seoPost<T = unknown>(token: string, path: string, body: unknown): Promise<SeoResult<T>> {
  return request<T>(token, path, { method: "POST", body: JSON.stringify(body) });
}

export function seoPatch<T = unknown>(token: string, path: string, body: unknown): Promise<SeoResult<T>> {
  return request<T>(token, path, { method: "PATCH", body: JSON.stringify(body) });
}

/** Rows from a GET that may return {items:[…]}, {rows:[…], total}, a bare array, or nothing yet. */
export function rowsOf<T = Record<string, unknown>>(result: SeoResult<unknown>): T[] {
  if (!result.ok) return [];
  const d = result.data as { items?: T[]; rows?: T[] } | T[] | null | undefined;
  if (Array.isArray(d)) return d;
  if (d && Array.isArray((d as { items?: T[] }).items)) return (d as { items: T[] }).items;
  // listCrawlPages (and other paged endpoints) answer { rows, total }; this
  // returned [] for them, so a 128-page crawl showed "No pages recorded".
  if (d && Array.isArray((d as { rows?: T[] }).rows)) return (d as { rows: T[] }).rows;
  return [];
}

/** A human explanation for a failed load — pages show this verbatim. */
export function emptyReason(result: SeoResult<unknown>, awaiting: string): string | null {
  if (result.ok) return null;
  if (result.notFound) return `${awaiting} (the API endpoint is not mounted yet — no data has been invented in its place).`;
  return result.message;
}

export const str = (v: unknown): string => (v === null || v === undefined ? "—" : String(v));
export const num = (v: unknown): string =>
  typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-UG") : "—";
export const pct = (v: unknown): string =>
  typeof v === "number" && Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—";
export const fmtWhen = (iso: unknown): string => {
  if (typeof iso !== "string" || !iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
