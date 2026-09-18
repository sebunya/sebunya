/**
 * Admin helpers for AI Search (/admin/ai-search/**), over the API at
 * /admin/ai-visibility. Every screen is a thin view: the numbers, gaps,
 * recommendations and approval rules all come from the API, so an agent
 * calling the same endpoints sees exactly what the operator sees.
 */
import { apiBase } from "./api";

export type AivResult<T> = { ok: true; data: T; status: number } | { ok: false; status: number; code: string; message: string };

async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<AivResult<T>> {
  try {
    const res = await fetch(`${apiBase}/admin/ai-visibility${path}`, {
      method,
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, code: "DENIED", message: json?.error?.message ?? "Your account does not have the AI Search permission this needs." };
    }
    if (!res.ok || !json?.success) {
      return { ok: false, status: res.status, code: json?.error?.code ?? "ERROR", message: json?.error?.message ?? `The API declined the request (HTTP ${res.status}).` };
    }
    return { ok: true, data: json.data as T, status: res.status };
  } catch {
    return { ok: false, status: 0, code: "UNREACHABLE", message: "Could not reach the API." };
  }
}

export const aivGet = <T>(t: string, p: string) => call<T>(t, "GET", p);
export const aivPost = <T>(t: string, p: string, b: unknown = {}) => call<T>(t, "POST", p, b);
export const aivPatch = <T>(t: string, p: string, b: unknown) => call<T>(t, "PATCH", p, b);
export const aivPut = <T>(t: string, p: string, b: unknown) => call<T>(t, "PUT", p, b);
export const aivDelete = <T>(t: string, p: string) => call<T>(t, "DELETE", p);

export const PROVIDER_LABEL: Record<string, string> = { OPENAI: "ChatGPT", ANTHROPIC: "Claude", GEMINI: "Gemini", PERPLEXITY: "Perplexity" };
export const providerLabel = (p: unknown) => PROVIDER_LABEL[String(p)] ?? String(p ?? "—");

/** A rate as a percentage, or "no data" — never 0% for an empty denominator. */
export const rate = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? `${Math.round(v * 100)}%` : "no data");
export const usd = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? `$${v.toFixed(v < 1 ? 3 : 2)}` : "—");
export const when = (iso: unknown): string => {
  if (typeof iso !== "string" || !iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kampala" });
};
export const delta = (now: unknown, before: unknown): string => {
  if (typeof now !== "number" || typeof before !== "number") return "";
  const d = Math.round((now - before) * 100);
  return d === 0 ? "no change" : `${d > 0 ? "+" : ""}${d} pts vs previous`;
};

/** Run state words an operator reads, not enum names. */
export const RUN_STATE: Record<string, string> = {
  AWAITING_APPROVAL: "Waiting for approval", QUEUED: "Queued", RUNNING: "Running", PARTIAL: "Finished with some failures",
  COMPLETED: "Completed", FAILED: "Failed", CANCELLED: "Cancelled", REJECTED: "Rejected",
};

export const DEFAULT_PROJECT = "goldplus";
