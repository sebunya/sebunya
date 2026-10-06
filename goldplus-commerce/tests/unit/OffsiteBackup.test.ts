import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(__dirname, '../..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const script = join(root, 'ops/backup/offsite-sync.sh');
const steward = join(root, 'ops/storage-steward/goldplus-storage-steward');

function backups() {
  const dir = mkdtempSync(join(tmpdir(), 'gp-offsite-'));
  mkdirSync(join(dir, 'nightly'));
  writeFileSync(join(dir, 'nightly', 'goldplus-prod-nightly-20261006-021552Z.dump'), 'dump-bytes');
  writeFileSync(join(dir, 'nightly', 'goldplus-media-nightly-20261006-021552Z.tar.gz'), 'tar-bytes');
  writeFileSync(join(dir, 'goldplus-prod-pre-0168-20261005-073954.dump'), 'premig');
  writeFileSync(join(dir, 'state.db'), 'never-travels');
  return dir;
}

function sync(dir: string, remote: string, mode: 'sync' | '--verify' = 'sync') {
  const r = spawnSync('bash', [script, mode], {
    env: { ...process.env, BACKUP_DIR: dir, OFFSITE_LOCAL_ONLY: remote, PATH: process.env.PATH },
    encoding: 'utf8',
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

describe('ops/backup/offsite-sync.sh', () => {
  it('refuses to run without a named target', () => {
    const dir = backups();
    const { code, out } = sync(dir, mkdtempSync(join(tmpdir(), 'gp-remote-')));
    expect(code).toBe(1);
    expect(out).toContain('.offsite-target is missing');
  });

  it('copies only dumps and archives, proves them, and writes the verified marker', () => {
    const dir = backups();
    const remote = mkdtempSync(join(tmpdir(), 'gp-remote-'));
    writeFileSync(join(dir, '.offsite-target'), 'u1@u1.your-storagebox.de:goldplus-backups\n');
    const { code, out } = sync(dir, remote);
    expect(code).toBe(0);
    expect(out).toContain('OK: 3 backup files present and same-sized');
    expect(existsSync(join(remote, 'nightly', 'goldplus-prod-nightly-20261006-021552Z.dump'))).toBe(true);
    expect(existsSync(join(remote, 'goldplus-prod-pre-0168-20261005-073954.dump'))).toBe(true);
    expect(existsSync(join(remote, 'state.db'))).toBe(false);
    const marker = readFileSync(join(dir, '.offsite-verified-at'), 'utf8');
    expect(marker).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z files=3 target=u1@u1/);
  });

  it('verify fails, and removes the marker, when the far side is missing a file or has a different size', () => {
    const dir = backups();
    const remote = mkdtempSync(join(tmpdir(), 'gp-remote-'));
    writeFileSync(join(dir, '.offsite-target'), 'u1@u1.your-storagebox.de:goldplus-backups\n');
    expect(sync(dir, remote).code).toBe(0);
    // a new local backup not yet copied
    writeFileSync(join(dir, 'nightly', 'goldplus-prod-nightly-20261007-021552Z.dump'), 'new');
    const r = sync(dir, remote, '--verify');
    expect(r.code).toBe(2);
    expect(r.out).toContain('goldplus-prod-nightly-20261007-021552Z.dump');
    expect(existsSync(join(dir, '.offsite-verified-at'))).toBe(false);
    // truncated on the far side
    expect(sync(dir, remote).code).toBe(0);
    writeFileSync(join(remote, 'nightly', 'goldplus-prod-nightly-20261007-021552Z.dump'), 'n');
    expect(sync(dir, remote, '--verify').code).toBe(2);
  });

  it('never deletes or overwrites on the remote', () => {
    const s = read('ops/backup/offsite-sync.sh');
    expect(s).not.toMatch(/--delete/);
    expect(s).toMatch(/--ignore-existing/);
  });

  it('the timer runs after the nightly dump and both units are installable', () => {
    expect(read('ops/backup/goldplus-offsite-sync.timer')).toMatch(/OnCalendar=\*-\*-\* 02:50:00 UTC/);
    expect(read('ops/backup/goldplus-pg-backup.timer')).toMatch(/OnCalendar=\*-\*-\* 02:15:00 UTC/);
    expect(read('ops/backup/goldplus-offsite-sync.service')).toMatch(/After=goldplus-pg-backup.service/);
    expect(read('ops/backup/README.md')).toContain('goldplus-offsite-sync.timer');
  });
});

describe('the Storage Steward honours the offsite marker and sends its alerts', () => {
  const py = (body: string, env: Record<string, string> = {}) =>
    execFileSync('python3', ['-c', `
import importlib.machinery, importlib.util, sys, types
loader = importlib.machinery.SourceFileLoader('steward', ${JSON.stringify(steward)})
spec = importlib.util.spec_from_loader('steward', loader)
m = importlib.util.module_from_spec(spec); sys.modules['steward'] = m; loader.exec_module(m)
${body}
`], { env: { ...process.env, ...env }, encoding: 'utf8' }).trim();

  it('no marker: no remote, and local recovery points are not expired', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-steward-'));
    expect(py(`print(m.remote_verified({"backups": {"directory": ${JSON.stringify(dir)}}}))`)).toContain('(False,');
  });

  it('a fresh marker from offsite-sync.sh counts as a verified remote; a stale one does not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-steward-'));
    const marker = join(dir, '.offsite-verified-at');
    writeFileSync(marker, '2026-10-06T02:51:00Z files=32 target=u1@u1.your-storagebox.de:goldplus-backups\n');
    expect(py(`print(m.remote_verified({"backups": {"directory": ${JSON.stringify(dir)}}}))`)).toContain('(True,');
    const old = new Date(Date.now() - 3 * 86_400_000);
    utimesSync(marker, old, old);
    const out = py(`print(m.remote_verified({"backups": {"directory": ${JSON.stringify(dir)}}}))`);
    expect(out).toContain('(False,');
    expect(out).toContain('falling behind');
  });

  it('the operator policy flag still works on its own', () => {
    expect(py(`print(m.remote_verified({"backups": {"remote_configured": True}}))`)).toContain('(True,');
  });

  it('record_alert reaches notify(), and notify() does nothing without a webhook URL', () => {
    const src = read('ops/storage-steward/goldplus-storage-steward');
    expect(src).toMatch(/def record_alert[\s\S]*?notify\(severity, cause, detail\)/);
    expect(py(`m.notify("HIGH", "x", "y"); print("sent-nothing")`, { ALERT_WEBHOOK_URL: '' })).toBe('sent-nothing');
    expect(read('ops/storage-steward/secrets.example/alerts.env')).toContain('ALERT_WEBHOOK_URL=');
  });
});

describe('deploy-prod.sh and compose hygiene', () => {
  it('the deploy script runs from a private copy so the checkout cannot change it mid-run', () => {
    const d = read('scripts/deploy-prod.sh');
    expect(d).toMatch(/GOLDPLUS_DEPLOY_SELF=1 exec bash "\$SELF" "\$@"/);
    expect(d.indexOf('GOLDPLUS_DEPLOY_SELF')).toBeLessThan(d.indexOf('git merge --ff-only'));
  });

  it('every deploy caps the build cache by SIZE at the Steward bound, not only by age', () => {
    const d = read('scripts/deploy-prod.sh');
    // Age alone left a busy day unbounded (21.3 GB on 2026-10-06).
    expect(d).toContain('docker builder prune -f --filter until=24h');
    expect(d).toContain('CACHE_CAP_GB="${BUILD_CACHE_MAX_GB:-2}"');
    // Docker 29 removed --keep-storage: detect the flag, never assume it, and
    // never via `--help | grep -q` (SIGPIPE under pipefail makes it look absent).
    expect(d).toMatch(/for f in --max-used-space --keep-storage; do/);
    expect(d).toContain('CACHE_HELP="$(docker builder prune --help 2>/dev/null || true)"');
    expect(d).not.toMatch(/prune --help[^\n]*\| *grep -q/);
    expect(d).toContain('docker builder prune -f "$CACHE_FLAG" "$(( CACHE_CAP_GB * 1024 * 1024 * 1024 ))"');
    // A failed cap is said out loud, never swallowed; a "successful" one is re-measured.
    expect(d).toContain('WARN: build cache cap');
    expect(d).toContain('echo "build cache after cap: $(docker system df');
    // Same bound as the Steward's policy.
    expect(read('ops/storage-steward/policy.yaml')).toMatch(/build_cache_max_gb: 2\b/);
    // Bounded, never a full wipe: a cold build loads the 2-vCPU host.
    expect(d).not.toMatch(/builder prune -a|builder prune -af|builder prune --all/);
  });

  it('a migration removes older migrator images, keeping the one it used, and never fails on it', () => {
    const m = read('scripts/migrate-prod.sh');
    const tail = m.slice(m.indexOf('echo "MIGRATED live'));
    expect(tail).toContain('docker images goldplus-migrator');
    expect(tail).toContain('grep -vxF "$MIG"');
    expect(tail).toMatch(/xargs -r docker image rm[^\n]*\|\| true/);
  });

  it('pghero credentials default to empty instead of warning on every compose command', () => {
    const c = read('docker-compose.production.yml');
    expect(c).toContain('PGHERO_USERNAME=${PGHERO_USERNAME:-}');
    expect(c).toContain('PGHERO_PASSWORD=${PGHERO_PASSWORD:-}');
  });
});
