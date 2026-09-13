// Provider harness. Every JavaScript provider runner calls runProvider() with a
// name and an async worker. The harness gives the worker the resolved config,
// the run directory and a `save` helper; it records status, raw (redacted)
// output and normalized metrics in the run's providers/<name>/ folder, and it
// never lets an exception escape as an unhandled crash — the orchestrator sees
// a status file either way.
//
// Usage from a runner:   runProvider('gtmetrix', async (ctx) => { ...; return { status, metrics, raw, summary, refs } })
//
// Status vocabulary (fixed): IMPLEMENTED_AND_VERIFIED | IMPLEMENTED_AWAITING_CREDENTIALS |
//   IMPLEMENTED_AWAITING_SUBSCRIPTION | BLOCKED_BY_PROVIDER | SKIPPED_FOR_SAFETY |
//   UNSUPPORTED_BY_CURRENT_PROVIDER | PROVIDER_FAILURE | DISABLED
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, loadEnv, heavyLoadDecision } from './config.mjs';
import { redactObject, registerSecret, looksLikeItHasSecrets, redactText } from './redact.mjs';

export const STATUSES = ['IMPLEMENTED_AND_VERIFIED', 'IMPLEMENTED_AWAITING_CREDENTIALS', 'IMPLEMENTED_AWAITING_SUBSCRIPTION', 'BLOCKED_BY_PROVIDER', 'SKIPPED_FOR_SAFETY', 'UNSUPPORTED_BY_CURRENT_PROVIDER', 'PROVIDER_FAILURE', 'DISABLED'];

export function providerContext(name) {
  const env = loadEnv();
  for (const [k, v] of Object.entries(env)) if (/KEY|TOKEN|SECRET|WEBHOOK/i.test(k) && v) registerSecret(v);
  const cfg = loadConfig(env);
  const runDir = process.env.PERF_AUDIT_RUN_DIR;
  if (!runDir) throw new Error('PERF_AUDIT_RUN_DIR is not set (run through run_all.sh)');
  const dir = resolve(runDir, 'providers', name);
  mkdirSync(dir, { recursive: true });
  const timeoutMs = ((cfg.timeouts_seconds?.[name] ?? cfg.timeouts_seconds?.provider_default ?? 900) * 1000);
  const log = (msg) => process.stdout.write(`[${name}] ${redactText(msg)}\n`);
  const save = (file, data) => {
    const payload = typeof data === 'string' ? redactText(data) : JSON.stringify(redactObject(data), null, 2) + '\n';
    if (looksLikeItHasSecrets(payload)) throw new Error(`refusing to save ${file}: a credential-looking value survived redaction`);
    writeFileSync(resolve(dir, file), payload);
    return resolve(dir, file);
  };
  return { name, env, cfg, resolved: cfg.resolved, dir, runDir, timeoutMs, log, save, heavy: heavyLoadDecision(cfg.resolved), enabled: cfg.providers?.[name] !== false };
}

export async function runProvider(name, worker) {
  const started = new Date().toISOString();
  let ctx;
  try { ctx = providerContext(name); } catch (e) { process.stderr.write(`[${name}] ${e.message}\n`); process.exit(2); }
  const finish = (result) => {
    const status = STATUSES.includes(result.status) ? result.status : 'PROVIDER_FAILURE';
    const out = { provider: name, status, started_at: started, finished_at: new Date().toISOString(), summary: redactText(result.summary || ''), refs: result.refs || {}, limitations: result.limitations || null, error: result.error ? redactText(result.error) : null };
    ctx.save('status.json', out);
    ctx.save('normalized.json', { provider: name, status, metrics: result.metrics || [] });
    if (result.raw !== undefined) ctx.save('raw.json', result.raw);
    if (result.markdown) ctx.save('summary.md', result.markdown);
    ctx.log(`${status}${result.summary ? ' — ' + result.summary : ''}`);
    return out;
  };
  if (!ctx.enabled) { finish({ status: 'DISABLED', summary: 'disabled in audit.config.yaml' }); return; }
  const timer = setTimeout(() => { finish({ status: 'PROVIDER_FAILURE', error: `timed out after ${ctx.timeoutMs / 1000}s`, summary: 'timeout' }); process.exit(3); }, ctx.timeoutMs);
  try {
    const result = await worker(ctx);
    clearTimeout(timer);
    const out = finish(result || { status: 'PROVIDER_FAILURE', error: 'worker returned nothing' });
    process.exit(out.status === 'PROVIDER_FAILURE' ? 1 : 0);
  } catch (e) {
    clearTimeout(timer);
    finish({ status: 'PROVIDER_FAILURE', error: e && e.message ? e.message : String(e), summary: 'failed' });
    process.exit(1);
  }
}

/** Common answer when a key is missing. */
export function awaitingCredentials(what, howTo) {
  return { status: 'IMPLEMENTED_AWAITING_CREDENTIALS', summary: `${what} not configured`, limitations: howTo, metrics: [] };
}
