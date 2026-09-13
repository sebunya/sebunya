// Configuration loader: audit.config.yaml (non-secret) + .env (secrets, per-runner).
// Writes config.resolved.json for the Python steps, WITHOUT any secret in it.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export const AUDIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Names that are secrets: never written to resolved config, manifests or logs. */
export const SECRET_ENV_NAMES = [
  'WPT_API_KEY', 'GTMETRIX_API_KEY', 'DEBUGBEAR_API_KEY', 'SPEEDVITALS_API_KEY', 'PINGDOM_API_TOKEN',
  'LOADERIO_API_KEY', 'LOADERIO_VERIFICATION_TOKEN', 'SPEEDCURVE_API_KEY', 'PERF_AUDIT_ALERT_WEBHOOK_URL',
];

/** Parse a .env file into a plain object (no shell expansion, no export keyword needed). */
export function parseDotenv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

/**
 * Admin-managed settings (written by the GoldPlus API from /admin/seo/performance-audit/settings,
 * never by hand): $PERF_AUDIT_DATA_DIR/settings/config.overrides.json { env: {...}, config: {...} }
 * and $PERF_AUDIT_DATA_DIR/settings/secrets.env (provider credentials, mode 600).
 * Precedence, lowest to highest: audit.config.yaml → performance-audit/.env → admin settings → process env.
 * A malformed overrides file is IGNORED with a reason (the audit must still run), never partially applied.
 */
export const OVERRIDABLE_SECTIONS = ['providers', 'canary', 'budget', 'regression', 'retention'];
export const OVERRIDABLE_ENV = ['TARGET_URL', 'AUDIT_PRODUCT_URL', 'LOAD_TARGET_URL', 'WPT_SERVER', 'DEBUGBEAR_PROJECT_ID', 'SPEEDCURVE_SITE_ID'];

export function readAdminSettings(dataDir) {
  const out = { env: {}, config: {}, secrets: {}, source: null, error: null };
  if (!dataDir) return out;
  const overridesPath = resolve(dataDir, 'settings', 'config.overrides.json');
  if (existsSync(overridesPath)) {
    try {
      const doc = JSON.parse(readFileSync(overridesPath, 'utf8'));
      const env = doc && typeof doc.env === 'object' && doc.env ? doc.env : {};
      for (const k of OVERRIDABLE_ENV) if (typeof env[k] === 'string') out.env[k] = env[k];
      const config = doc && typeof doc.config === 'object' && doc.config ? doc.config : {};
      for (const k of OVERRIDABLE_SECTIONS) if (config[k] && typeof config[k] === 'object') out.config[k] = config[k];
      if (config.schedule && typeof config.schedule === 'object' && Number.isFinite(Number(config.schedule.interval_seconds))) out.config.schedule = { interval_seconds: Number(config.schedule.interval_seconds) };
      if (config.target && typeof config.target === 'object' && config.target.pages && typeof config.target.pages === 'object') out.config.target = { pages: config.target.pages };
      out.source = overridesPath;
    } catch (e) { out.error = `settings/config.overrides.json ignored: ${e.message}`; }
  }
  const secretsPath = resolve(dataDir, 'settings', 'secrets.env');
  if (existsSync(secretsPath)) {
    try { for (const [k, v] of Object.entries(parseDotenv(readFileSync(secretsPath, 'utf8')))) if (SECRET_ENV_NAMES.includes(k) && v) out.secrets[k] = v; }
    catch (e) { out.error = `${out.error ? out.error + '; ' : ''}settings/secrets.env unreadable: ${e.message}`; }
  }
  return out;
}

export function loadEnv(envPath = resolve(AUDIT_ROOT, '.env')) {
  const fileEnv = existsSync(envPath) ? parseDotenv(readFileSync(envPath, 'utf8')) : {};
  const processEnv = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined));
  const dataDir = processEnv.PERF_AUDIT_DATA_DIR || fileEnv.PERF_AUDIT_DATA_DIR || resolve(AUDIT_ROOT, 'data');
  const admin = readAdminSettings(dataDir);
  // .env < admin settings < process environment (the runner may inject secrets without a file).
  return { ...fileEnv, ...admin.env, ...admin.secrets, ...processEnv, __ADMIN_SETTINGS_ERROR: admin.error || '' , __ADMIN_SETTINGS_SOURCE: admin.source || '' };
}

function mergeSection(base, override) {
  if (!override || typeof override !== 'object') return base;
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(override)) out[k] = v;
  return out;
}

export function loadConfig(env = loadEnv()) {
  const raw = yaml.load(readFileSync(resolve(AUDIT_ROOT, 'audit.config.yaml'), 'utf8'));
  const dataDir = env.PERF_AUDIT_DATA_DIR || resolve(AUDIT_ROOT, 'data');
  const admin = readAdminSettings(dataDir);
  const cfg = { ...raw };
  for (const k of OVERRIDABLE_SECTIONS) if (admin.config[k]) cfg[k] = mergeSection(raw[k], admin.config[k]);
  if (admin.config.schedule) cfg.schedule = { ...raw.schedule, interval_seconds: admin.config.schedule.interval_seconds };
  if (admin.config.target) cfg.target = { ...raw.target, pages: admin.config.target.pages };
  cfg.admin_settings = { applied: Object.keys(admin.config).length > 0 || Object.keys(admin.env).length > 0 || Object.keys(admin.secrets).length > 0, source: admin.source, error: admin.error, overridden_sections: Object.keys(admin.config), overridden_env: Object.keys(admin.env), secrets_from_admin: Object.keys(admin.secrets) };
  const targetUrl = (env.TARGET_URL || cfg.target.url).replace(/\/+$/, '');
  const productUrl = env[cfg.target.product_url_env] || '';
  return {
    ...cfg,
    resolved: {
      targetUrl,
      productUrl,
      dataDir,
      loadTargetUrl: (env.LOAD_TARGET_URL || '').replace(/\/+$/, ''),
      allowProdLoadTest: String(env.ALLOW_PROD_LOAD_TEST || '').toLowerCase() === 'true',
      prodLoadTestAck: env.PROD_LOAD_TEST_ACK || '',
      credentials: Object.fromEntries(SECRET_ENV_NAMES.map((n) => [n, Boolean((env[n] || '').trim())])), // presence only
      debugbearProjectId: env.DEBUGBEAR_PROJECT_ID || '',
      speedcurveSiteId: env.SPEEDCURVE_SITE_ID || '',
      wptServer: env.WPT_SERVER || 'https://www.webpagetest.org',
    },
  };
}

/** Write the secret-free resolved config for shell/python steps. */
export function writeResolvedConfig(cfg, path = resolve(AUDIT_ROOT, 'config.resolved.json')) {
  for (const name of SECRET_ENV_NAMES) if (name in cfg) throw new Error(`refusing to write secret ${name} into resolved config`);
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
  return path;
}

/**
 * The heavy-load gate. Heavy profiles (k6 ramp, Artillery, Loader.io) may run
 * only against LOAD_TARGET_URL. If that is the production host, BOTH
 * ALLOW_PROD_LOAD_TEST=true and the exact acknowledgement are required.
 */
export const PROD_LOAD_ACK = 'I_UNDERSTAND_THIS_GENERATES_REAL_TRAFFIC';
export function heavyLoadDecision(resolved) {
  const { targetUrl, loadTargetUrl, allowProdLoadTest, prodLoadTestAck } = resolved;
  if (!loadTargetUrl) return { allowed: false, status: 'SKIPPED_FOR_SAFETY', reason: 'LOAD_TARGET_URL is not set; heavy load never targets production by default.' };
  const same = hostOf(loadTargetUrl) === hostOf(targetUrl);
  if (same) {
    if (allowProdLoadTest && prodLoadTestAck === PROD_LOAD_ACK) {
      return { allowed: true, status: 'ALLOWED_PRODUCTION_EXPLICIT', reason: 'LOAD_TARGET_URL is production and both explicit approvals are present.' };
    }
    return { allowed: false, status: 'SKIPPED_FOR_SAFETY', reason: 'LOAD_TARGET_URL is the production host but ALLOW_PROD_LOAD_TEST=true and PROD_LOAD_TEST_ACK are not both present. Heavy load aborted.' };
  }
  return { allowed: true, status: 'ALLOWED_NON_PRODUCTION', reason: `LOAD_TARGET_URL (${hostOf(loadTargetUrl)}) is not the production host.` };
}
export function hostOf(url) { try { return new URL(url).host.toLowerCase().replace(/^www\./, ''); } catch { return ''; } }
