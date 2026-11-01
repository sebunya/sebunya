/**
 * Admin helpers for the SEO Integrations Control Plane UI
 * (/admin/seo/integrations/**), over the API mounted at the same path.
 *
 * Reuses the honest-result pattern from adminSeo.ts: nothing throws, nothing
 * is fabricated, and pages render zero-states from these results verbatim.
 *
 * Secret discipline: this module (and every page that imports it) only ever
 * handles credential MASKS ('••••AB12'); plaintext secrets pass through form
 * POST bodies straight to the API and are never rendered back.
 */
import { apiBase } from "./api";
import { seoGet, seoPost, seoPatch, type SeoResult } from "./adminSeo";

export const INTEGRATIONS_API = "/admin/seo/integrations";

// ── Types mirrored from the API/manifests ───────────────────────────────────

export type ManifestFieldType = "text" | "url" | "select" | "number" | "password-json";

export interface ManifestField {
  key: string;
  label: string;
  type: ManifestFieldType;
  required: boolean;
  help?: string;
  options?: string[];
}

export interface ProviderManifest {
  providerId?: string;
  canonicalName?: string;
  family?: string;
  description?: string;
  authTypes?: string[];
  capabilities?: string[];
  supports?: {
    webhooks?: boolean; backfill?: boolean; manualSync?: boolean;
    incrementalSync?: boolean; testConnection?: boolean; multipleConnections?: boolean;
  };
  defaultSyncFrequency?: string | null;
  docsUrl?: string | null;
  enabled?: boolean;
  experimental?: boolean;
  configurationSchema?: ManifestField[];
  credentialSchema?: ManifestField[];
  quota?: { dailyRequestCap?: number | null; notes?: string };
  backfillWindowMonths?: number;
  oauthScopes?: string[];
  notes?: string;
}

export interface ProviderRow {
  provider_id?: string;
  canonical_name?: string;
  family?: string;
  description?: string;
  auth_types?: string[];
  capabilities?: string[];
  supports?: ProviderManifest["supports"];
  default_sync_frequency?: string | null;
  enabled?: boolean;
  experimental?: boolean;
  manifest?: ProviderManifest;
}

export interface ConnectionRow {
  id?: string;
  provider_id?: string;
  name?: string;
  status?: string;
  account_ref?: string | null;
  property_ref?: string | null;
  config?: Record<string, unknown>;
  enabled_capabilities?: string[];
  sync_frequency?: string | null;
  backfill_window_days?: number | null;
  last_attempt_at?: string | null;
  last_success_at?: string | null;
  last_error?: string | null;
  freshness?: "FRESH" | "STALE" | "NO_DATA";
}

export interface CredentialRow {
  id?: string;
  auth_type?: string;
  mask?: string;
  version?: number;
  status?: string;
  created_at?: string;
  expires_at?: string | null;
  revoked_at?: string | null;
}

export interface SyncJobRow {
  id?: string;
  connection_id?: string;
  job_type?: string;
  status?: string;
  requested_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  records_read?: number | null;
  records_inserted?: number | null;
  records_updated?: number | null;
  records_rejected?: number | null;
  cursor?: string | null;
  error?: string | null;
}

export interface AuditRow {
  id?: string;
  connection_id?: string | null;
  provider_id?: string | null;
  action?: string;
  actor_id?: string;
  detail?: Record<string, unknown>;
  created_at?: string;
}

export interface TestStageResult { stage?: string; ok?: boolean; detail?: string }
export interface TestResult {
  ok?: boolean;
  stages?: TestStageResult[];
  errorCode?: string;
  errorMessage?: string;
  connectionStatus?: string;
}

// ── Fetch helpers (GET/POST/PATCH reuse adminSeo; DELETE added here) ────────

export const intGet = seoGet;
export const intPost = seoPost;
export const intPatch = seoPatch;

export async function intDelete<T = unknown>(token: string, path: string): Promise<SeoResult<T>> {
  try {
    const res = await fetch(`${apiBase}${path}`, {
      method: "DELETE",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => null);
    if (res.status === 404) return { ok: false, notFound: true, message: "This part of the Organic Growth API is not available yet." };
    if (res.status === 401 || res.status === 403) return { ok: false, denied: true, message: "Your account does not carry the permission for this SEO module." };
    if (!res.ok || !json?.success) return { ok: false, message: json?.error?.message ?? `The API declined the request (HTTP ${res.status}).` };
    return { ok: true, data: json.data as T };
  } catch {
    return { ok: false, message: "Could not reach the API." };
  }
}

// ── Friendly typed-error messages (all 9 canonical codes) ───────────────────

export const FRIENDLY_ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIAL: "The credential was rejected by the provider. Re-check the key/JSON and add a fresh credential.",
  AUTH_EXPIRED: "The authorization has expired. Re-run the OAuth consent flow or rotate the credential.",
  INSUFFICIENT_SCOPE: "The credential works but lacks the required scope/permission on the provider side. Grant access to the account/property, then test again.",
  PROPERTY_NOT_FOUND: "The selected property could not be found. Re-run discovery and pick a property the credential can actually see.",
  ACCOUNT_NOT_ACCESSIBLE: "The account exists but this credential cannot access it. Grant the service account or OAuth user access on the provider side.",
  QUOTA_EXCEEDED: "The provider's quota for this credential is exhausted. Wait for the quota window to reset before syncing again.",
  RATE_LIMITED: "Too many requests right now (provider rate limit or the daily request cap). Try again later.",
  PROVIDER_UNAVAILABLE: "The provider did not respond or returned a server error. This is on their side — try again later.",
  CONFIGURATION_ERROR: "The connection's configuration is incomplete or invalid. Review the configuration fields and required values.",
};

export function friendlyError(code: unknown, fallback?: unknown): string {
  const c = typeof code === "string" ? code : "";
  return FRIENDLY_ERROR_MESSAGES[c] ?? (typeof fallback === "string" && fallback ? fallback : "The operation failed; no typed error code was returned.");
}

// ── Family filter buckets (marketplace) ─────────────────────────────────────

export const FAMILY_FILTERS = [
  "Google", "Microsoft/Bing", "Performance", "SERP", "Keyword",
  "Backlinks", "AI", "Merchant", "Local", "Other",
] as const;
export type FamilyFilter = (typeof FAMILY_FILTERS)[number];

const FAMILY_BUCKET: Record<string, FamilyFilter> = {
  GOOGLE_SEARCH: "Google",
  GOOGLE_ANALYTICS: "Google",
  GOOGLE_PERFORMANCE: "Google",
  GOOGLE_MERCHANT: "Merchant",
  GOOGLE_LOCAL: "Local",
  MICROSOFT_SEARCH: "Microsoft/Bing",
  INDEXING_PROTOCOL: "Microsoft/Bing",
  WEB_PERFORMANCE: "Performance",
  SERP_PROVIDER: "SERP",
  KEYWORD_PROVIDER: "Keyword",
  BACKLINK_PROVIDER: "Backlinks",
  AI_ENGINE: "AI",
  CUSTOM_READ_ONLY: "Other",
};

export function familyBucketOf(family: unknown): FamilyFilter {
  return FAMILY_BUCKET[String(family ?? "")] ?? "Other";
}

// ── Status derivation (honest — words only, no invented percentages) ────────

export const STATUS_VIEWS = ["ALL", "CONNECTED", "AVAILABLE", "NEEDS_SETUP", "ERROR", "DISABLED"] as const;
export type StatusView = (typeof STATUS_VIEWS)[number];

const ERROR_STATUSES = new Set(["ERROR", "AUTH_EXPIRED", "PERMISSION_ERROR", "PROVIDER_ERROR"]);
const NEEDS_SETUP_STATUSES = new Set(["CONFIGURING", "AUTHORIZATION_REQUIRED", "RATE_LIMITED"]);

/** One honest status word for a provider from its connections; no connections → NOT_CONFIGURED. */
export function deriveProviderStatus(connections: ConnectionRow[]): string {
  if (connections.length === 0) return "NOT_CONFIGURED";
  const statuses = connections.map((c) => String(c.status ?? "NOT_CONFIGURED"));
  for (const s of statuses) if (ERROR_STATUSES.has(s)) return s;
  if (statuses.includes("CONNECTED")) return "CONNECTED";
  if (statuses.includes("READY")) return "READY";
  for (const s of statuses) if (NEEDS_SETUP_STATUSES.has(s)) return s;
  if (statuses.every((s) => s === "DISABLED")) return "DISABLED";
  return statuses[0];
}

/** Marketplace view bucket for a derived provider status. */
export function statusViewOf(status: string): Exclude<StatusView, "ALL"> {
  if (ERROR_STATUSES.has(status)) return "ERROR";
  if (status === "CONNECTED" || status === "READY") return "CONNECTED";
  if (status === "DISABLED") return "DISABLED";
  if (NEEDS_SETUP_STATUSES.has(status)) return "NEEDS_SETUP";
  return "AVAILABLE"; // NOT_CONFIGURED — honestly not set up, ready to be
}

/** Badge colour classes per status word (words only — never a health %). */
export function statusBadgeClass(status: string): string {
  const view = statusViewOf(status);
  if (view === "CONNECTED") return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (view === "ERROR") return "border-red-300 bg-red-50 text-red-900";
  if (view === "NEEDS_SETUP") return "border-amber-300 bg-amber-50 text-amber-900";
  if (view === "DISABLED") return "border-gray-300 bg-gray-100 text-gray-500";
  return "border-gray-300 bg-gray-50 text-gray-600";
}

export function freshnessBadgeClass(freshness: string): string {
  if (freshness === "FRESH") return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (freshness === "STALE") return "border-amber-300 bg-amber-50 text-amber-900";
  return "border-gray-300 bg-gray-50 text-gray-600"; // NO_DATA — distinct, honest
}

// ── Generic manifest-schema form support ────────────────────────────────────

/** Every field type the manifests may declare; the renderer must cover all of these. */
export const SUPPORTED_FIELD_TYPES: ManifestFieldType[] = ["text", "url", "select", "number", "password-json"];

/** HTML input rendering plan for a manifest field. password-json fields are
 *  ALWAYS textareas treated as secrets: POSTed once, never echoed back. */
export function fieldControlOf(field: ManifestField): { control: "input" | "select" | "textarea"; inputType: string } {
  switch (field.type) {
    case "select": return { control: "select", inputType: "select" };
    case "password-json": return { control: "textarea", inputType: "password" };
    case "number": return { control: "input", inputType: "number" };
    case "url": return { control: "input", inputType: "url" };
    default: return { control: "input", inputType: "text" };
  }
}

/** Read a manifest-schema form submission back into a config/secret object.
 *  Empty optional fields are omitted; numbers are coerced. */
export function readSchemaForm(fields: ManifestField[], form: FormData, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = String(form.get(`${prefix}${f.key}`) ?? "").trim();
    if (raw === "") continue;
    out[f.key] = f.type === "number" ? Number(raw) : raw;
  }
  return out;
}

// ── Misc formatting ─────────────────────────────────────────────────────────

export const SYNC_FREQUENCIES = ["HOURLY", "DAILY", "WEEKLY", "MONTHLY"] as const;

export function durationOf(startedAt: unknown, completedAt: unknown): string {
  if (typeof startedAt !== "string" || typeof completedAt !== "string") return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
