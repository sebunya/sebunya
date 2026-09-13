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

export function loadEnv(envPath = resolve(AUDIT_ROOT, '.env')) {
  const fileEnv = existsSync(envPath) ? parseDotenv(readFileSync(envPath, 'utf8')) : {};
  // Process environment wins (the runner may inject secrets without a file).
  return { ...fileEnv, ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) };
}

export function loadConfig(env = loadEnv()) {
  const cfg = yaml.load(readFileSync(resolve(AUDIT_ROOT, 'audit.config.yaml'), 'utf8'));
  const targetUrl = (env.TARGET_URL || cfg.target.url).replace(/\/+$/, '');
  const dataDir = env.PERF_AUDIT_DATA_DIR || resolve(AUDIT_ROOT, 'data');
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
