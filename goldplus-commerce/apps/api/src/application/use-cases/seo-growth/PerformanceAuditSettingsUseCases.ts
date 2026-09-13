import type { IPerformanceAuditStore, PerformanceAuditSettingsDocument } from '../../ports/IPerformanceAuditStore';

/**
 * Admin-editable settings for the Continuous Performance Assurance system (2026-09-13).
 *
 * After launch the owner must be able to change what the audit measures, how
 * often, against which budgets, with which providers and credentials — without
 * a terminal. The API writes two files into the audit data directory that the
 * host runner layers over the repository defaults (performance-audit/lib/config.mjs):
 *   settings/config.overrides.json  { env: {...non-secret}, config: {...sections} }
 *   settings/secrets.env            provider credentials + alert webhook, mode 600
 * The shell path keeps working unchanged: the same files are read by run_all.sh.
 *
 * What is deliberately NOT editable here: ALLOW_PROD_LOAD_TEST and
 * PROD_LOAD_TEST_ACK. Heavy load against the production host stays a
 * terminal-only, two-value decision; the admin may set a STAGING load target.
 */

export const SETTINGS_PROVIDERS = ['webpagetest', 'wpt_ecommerce_flow', 'gtmetrix', 'debugbear', 'speedvitals', 'pingdom', 'yellowlab', 'keycdn', 'k6', 'artillery', 'loaderio', 'speedcurve', 'observatory', 'webhint', 'lighthouse', 'compatibility'] as const;
export const SETTINGS_SECRETS = ['WPT_API_KEY', 'GTMETRIX_API_KEY', 'DEBUGBEAR_API_KEY', 'SPEEDVITALS_API_KEY', 'PINGDOM_API_TOKEN', 'LOADERIO_API_KEY', 'LOADERIO_VERIFICATION_TOKEN', 'SPEEDCURVE_API_KEY', 'PERF_AUDIT_ALERT_WEBHOOK_URL'] as const;
export const SETTINGS_ENV = ['TARGET_URL', 'AUDIT_PRODUCT_URL', 'LOAD_TARGET_URL', 'WPT_SERVER', 'DEBUGBEAR_PROJECT_ID', 'SPEEDCURVE_SITE_ID'] as const;
export const BUDGET_KEYS = ['lcp_ms', 'fcp_ms', 'ttfb_ms', 'tbt_ms', 'cls', 'inp_ms', 'speed_index_ms', 'total_bytes', 'js_bytes', 'requests', 'p95_latency_ms', 'error_rate', 'observatory_score'] as const;
export const REGRESSION_KEYS = ['lcp_pct', 'fcp_pct', 'ttfb_pct', 'tbt_pct', 'speed_index_pct', 'cls_abs', 'js_bytes_pct', 'total_bytes_pct', 'requests_pct', 'p95_latency_pct', 'critical_multiplier', 'noise_floor_ms', 'noise_floor_bytes'] as const;
export const MIN_INTERVAL_DAYS = 1;
export const MAX_INTERVAL_DAYS = 30;

export type SettingsSecretName = typeof SETTINGS_SECRETS[number];

export interface SettingsInput {
  env?: Partial<Record<typeof SETTINGS_ENV[number], unknown>>;
  intervalDays?: unknown;
  pages?: unknown; // { name: path }
  providers?: Record<string, unknown>;
  canary?: { enabled?: unknown; vus?: unknown; duration_seconds?: unknown; paths?: unknown };
  budget?: Record<string, unknown>;
  regression?: Record<string, unknown>;
  retention?: { keep_runs?: unknown; keep_ad_hoc_runs?: unknown };
  /** Secrets: a non-empty string sets, the empty string clears, undefined leaves untouched. */
  secrets?: Partial<Record<SettingsSecretName, unknown>>;
}

export type SettingsValidation =
  | { ok: true; overrides: PerformanceAuditSettingsDocument; secretsToSet: Record<string, string>; secretsToClear: string[] }
  | { ok: false; code: 'BAD_INPUT'; message: string; field: string };

const isHttps = (v: string) => { try { const u = new URL(v); return u.protocol === 'https:' && !!u.host; } catch { return false; } };
const hostOf = (v: string) => { try { return new URL(v).host.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/** Pure: turns a settings form into the two documents the runner reads, or the first problem found. */
export function validateSettingsInput(input: SettingsInput, current: { productionHost: string }): SettingsValidation {
  const bad = (field: string, message: string): SettingsValidation => ({ ok: false, code: 'BAD_INPUT', message, field });
  const env: Record<string, string> = {};
  for (const k of SETTINGS_ENV) {
    const v = input.env?.[k];
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s === '') { env[k] = ''; continue; }
    if (k === 'TARGET_URL' || k === 'AUDIT_PRODUCT_URL' || k === 'LOAD_TARGET_URL' || k === 'WPT_SERVER') {
      if (!isHttps(s)) return bad(k, `${k} must be an https URL.`);
    }
    if (k === 'DEBUGBEAR_PROJECT_ID' || k === 'SPEEDCURVE_SITE_ID') { if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) return bad(k, `${k} must be an identifier (letters, digits, - or _).`); }
    env[k] = s.replace(/\/+$/, '');
  }
  const targetHost = env.TARGET_URL ? hostOf(env.TARGET_URL) : current.productionHost;
  if (env.AUDIT_PRODUCT_URL && hostOf(env.AUDIT_PRODUCT_URL) !== targetHost) return bad('AUDIT_PRODUCT_URL', 'The test product must live on the audited site.');
  if (env.LOAD_TARGET_URL && hostOf(env.LOAD_TARGET_URL) === (current.productionHost || targetHost)) {
    return bad('LOAD_TARGET_URL', 'Heavy load against the production host cannot be enabled from the back office. Set a staging host here; production needs the two terminal-only approvals.');
  }

  const config: PerformanceAuditSettingsDocument['config'] = {};
  if (input.intervalDays !== undefined && input.intervalDays !== null && String(input.intervalDays).trim() !== '') {
    const d = num(input.intervalDays);
    if (d === null || !Number.isInteger(d) || d < MIN_INTERVAL_DAYS || d > MAX_INTERVAL_DAYS) return bad('intervalDays', `Interval must be a whole number of days between ${MIN_INTERVAL_DAYS} and ${MAX_INTERVAL_DAYS}.`);
    config.schedule = { interval_seconds: d * 86400 };
  }
  if (input.pages !== undefined && input.pages !== null) {
    if (typeof input.pages !== 'object' || Array.isArray(input.pages)) return bad('pages', 'Pages must be a map of name → path.');
    const pages: Record<string, string> = {};
    for (const [name, path] of Object.entries(input.pages as Record<string, unknown>)) {
      if (!/^[a-z][a-z0-9_]{0,19}$/.test(name)) return bad('pages', `Page name "${name}" must be lower-case letters, digits or _.`);
      const p = String(path ?? '').trim();
      if (!/^\/[A-Za-z0-9._~\-\/?=&%]*$/.test(p)) return bad('pages', `Path for "${name}" must start with / and contain no spaces.`);
      pages[name] = p;
    }
    if (!pages.home) return bad('pages', 'A "home" page is required.');
    if (Object.keys(pages).length > 6) return bad('pages', 'At most six pages per audit.');
    config.target = { pages };
  }
  if (input.providers) {
    const providers: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(input.providers)) {
      if (!(SETTINGS_PROVIDERS as readonly string[]).includes(k)) return bad('providers', `Unknown provider "${k}".`);
      providers[k] = v === true || v === 'true' || v === 'on' || v === '1';
    }
    config.providers = providers;
  }
  if (input.canary) {
    const c: Record<string, unknown> = {};
    if (input.canary.enabled !== undefined) c.enabled = input.canary.enabled === true || input.canary.enabled === 'true' || input.canary.enabled === 'on';
    if (input.canary.vus !== undefined && String(input.canary.vus).trim() !== '') { const v = num(input.canary.vus); if (v === null || !Number.isInteger(v) || v < 1 || v > 3) return bad('canary.vus', 'Canary virtual users must be 1 to 3 (it runs against production).'); c.vus = v; }
    if (input.canary.duration_seconds !== undefined && String(input.canary.duration_seconds).trim() !== '') { const v = num(input.canary.duration_seconds); if (v === null || !Number.isInteger(v) || v < 10 || v > 60) return bad('canary.duration_seconds', 'Canary duration must be 10 to 60 seconds.'); c.duration_seconds = v; }
    if (input.canary.paths !== undefined) {
      const paths = (Array.isArray(input.canary.paths) ? input.canary.paths : String(input.canary.paths).split(',')).map((p) => String(p).trim()).filter(Boolean);
      if (paths.length === 0 || paths.length > 4 || paths.some((p) => !/^\/[A-Za-z0-9._~\-\/?=&%]*$/.test(p))) return bad('canary.paths', 'Canary paths: 1 to 4 paths starting with /.');
      c.paths = paths;
    }
    if (Object.keys(c).length) config.canary = c;
  }
  for (const [section, keys] of [['budget', BUDGET_KEYS], ['regression', REGRESSION_KEYS]] as const) {
    const src = input[section];
    if (!src) continue;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(src)) {
      if (v === undefined || v === null || String(v).trim() === '') continue;
      if (!(keys as readonly string[]).includes(k)) return bad(section, `Unknown ${section} key "${k}".`);
      const n = num(v);
      if (n === null || n < 0) return bad(`${section}.${k}`, `${k} must be a number ≥ 0.`);
      out[k] = n;
    }
    if (Object.keys(out).length) config[section] = out;
  }
  if (input.retention) {
    const r: Record<string, number> = {};
    for (const k of ['keep_runs', 'keep_ad_hoc_runs'] as const) {
      const v = input.retention[k];
      if (v === undefined || v === null || String(v).trim() === '') continue;
      const n = num(v);
      if (n === null || !Number.isInteger(n) || n < 5 || n > 200) return bad(`retention.${k}`, `${k} must be a whole number between 5 and 200.`);
      r[k] = n;
    }
    if (Object.keys(r).length) config.retention = r;
  }

  const secretsToSet: Record<string, string> = {};
  const secretsToClear: string[] = [];
  for (const k of SETTINGS_SECRETS) {
    const v = input.secrets?.[k];
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s === '') { secretsToClear.push(k); continue; }
    if (s.length > 512 || /[\r\n]/.test(s)) return bad(k, `${k} must be a single line of at most 512 characters.`);
    if (k === 'PERF_AUDIT_ALERT_WEBHOOK_URL' && !isHttps(s)) return bad(k, 'The alert webhook must be an https URL.');
    secretsToSet[k] = s;
  }
  return { ok: true, overrides: { version: 1, env, config }, secretsToSet, secretsToClear };
}

export interface PerformanceAuditSettingsView {
  configured: boolean;
  /** What the runner used at its last run or tick (secret-free), or null before the first. */
  effective: Record<string, unknown> | null;
  /** The admin-written overrides as stored (secret-free). */
  overrides: PerformanceAuditSettingsDocument | null;
  /** Which credentials are present, never their values. */
  secretsPresent: Record<SettingsSecretName, boolean>;
  productionHost: string;
  limits: { minIntervalDays: number; maxIntervalDays: number; providers: readonly string[]; budgetKeys: readonly string[]; regressionKeys: readonly string[] };
}

export class GetPerformanceAuditSettingsUseCase {
  constructor(private readonly store: IPerformanceAuditStore) {}
  async execute(): Promise<PerformanceAuditSettingsView> {
    const configured = await this.store.isConfigured();
    const [effective, overrides, present]: [Record<string, unknown> | null, PerformanceAuditSettingsDocument | null, Record<string, boolean>] = configured
      ? await Promise.all([this.store.readEffectiveConfig(), this.store.readSettingsOverrides(), this.store.secretsPresence([...SETTINGS_SECRETS])])
      : [null, null, {}];
    const secretsPresent = Object.fromEntries(SETTINGS_SECRETS.map((k) => [k, Boolean(present[k])])) as Record<SettingsSecretName, boolean>;
    const resolved = (effective as { resolved?: { targetUrl?: string } } | null)?.resolved;
    return {
      configured, effective, overrides, secretsPresent,
      productionHost: hostOf(overrides?.env?.TARGET_URL || resolved?.targetUrl || 'https://shopgoldplus.com'),
      limits: { minIntervalDays: MIN_INTERVAL_DAYS, maxIntervalDays: MAX_INTERVAL_DAYS, providers: SETTINGS_PROVIDERS, budgetKeys: BUDGET_KEYS, regressionKeys: REGRESSION_KEYS },
    };
  }
}

export type UpdateSettingsResult =
  | { ok: true; overrides: PerformanceAuditSettingsDocument; secretsSet: string[]; secretsCleared: string[] }
  | { ok: false; code: 'NOT_CONFIGURED' | 'BAD_INPUT' | 'SETTINGS_UNAVAILABLE'; message: string; field?: string; status: number };

export class UpdatePerformanceAuditSettingsUseCase {
  constructor(private readonly store: IPerformanceAuditStore) {}
  /** Merges the submitted fields over the stored overrides (a field left out is left alone). */
  async execute(input: SettingsInput): Promise<UpdateSettingsResult> {
    if (!(await this.store.isConfigured())) return { ok: false, code: 'NOT_CONFIGURED', message: 'The audit data directory is not mounted into the API; settings cannot be stored.', status: 503 };
    const current = (await this.store.readSettingsOverrides()) ?? { version: 1, env: {}, config: {} };
    const effective = await this.store.readEffectiveConfig();
    const productionHost = hostOf(current.env?.TARGET_URL || (effective as { resolved?: { targetUrl?: string } } | null)?.resolved?.targetUrl || 'https://shopgoldplus.com');
    const v = validateSettingsInput(input, { productionHost });
    if (!v.ok) return { ok: false, code: 'BAD_INPUT', message: v.message, field: v.field, status: 400 };
    const merged: PerformanceAuditSettingsDocument = { version: 1, env: { ...current.env }, config: { ...current.config } };
    for (const [k, val] of Object.entries(v.overrides.env)) { if (val === '') delete merged.env[k]; else merged.env[k] = val; }
    for (const [section, val] of Object.entries(v.overrides.config)) (merged.config as Record<string, unknown>)[section] = val;
    try {
      await this.store.writeSettingsOverrides(merged);
      if (Object.keys(v.secretsToSet).length || v.secretsToClear.length) await this.store.updateSecrets(v.secretsToSet, v.secretsToClear);
    } catch (e) {
      return { ok: false, code: 'SETTINGS_UNAVAILABLE', message: `The settings directory is not writable from the API: ${(e as Error).message}`, status: 503 };
    }
    return { ok: true, overrides: merged, secretsSet: Object.keys(v.secretsToSet), secretsCleared: v.secretsToClear };
  }
}

export class ResetPerformanceAuditSettingsUseCase {
  constructor(private readonly store: IPerformanceAuditStore) {}
  /** Removes every override so the repository defaults apply again; credentials are kept unless `clearSecrets`. */
  async execute(opts: { clearSecrets: boolean }): Promise<{ ok: true } | { ok: false; code: 'NOT_CONFIGURED' | 'SETTINGS_UNAVAILABLE'; message: string; status: number }> {
    if (!(await this.store.isConfigured())) return { ok: false, code: 'NOT_CONFIGURED', message: 'The audit data directory is not mounted into the API.', status: 503 };
    try {
      await this.store.writeSettingsOverrides({ version: 1, env: {}, config: {} });
      if (opts.clearSecrets) await this.store.updateSecrets({}, [...SETTINGS_SECRETS]);
    } catch (e) { return { ok: false, code: 'SETTINGS_UNAVAILABLE', message: (e as Error).message, status: 503 }; }
    return { ok: true };
  }
}
