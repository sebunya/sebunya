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

export type SeoResult<T> =
  | { ok: true; data: T }
  | { ok: false; notFound?: boolean; denied?: boolean; message: string };

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
      return { ok: false, notFound: true, message: "This part of the Organic Growth API is not available yet." };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, denied: true, message: "Your account does not carry the permission for this SEO module." };
    }
    if (!res.ok || !json?.success) {
      return { ok: false, message: json?.error?.message ?? `The API declined the request (HTTP ${res.status}).` };
    }
    return { ok: true, data: json.data as T };
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

/** Rows from a GET that may return {items:[…]}, a bare array, or nothing yet. */
export function rowsOf<T = Record<string, unknown>>(result: SeoResult<unknown>): T[] {
  if (!result.ok) return [];
  const d = result.data as { items?: T[] } | T[] | null | undefined;
  if (Array.isArray(d)) return d;
  if (d && Array.isArray((d as { items?: T[] }).items)) return (d as { items: T[] }).items;
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
