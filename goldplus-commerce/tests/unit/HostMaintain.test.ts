import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, utimesSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(__dirname, '../..');
const script = join(root, 'scripts/host-maintain.sh');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

function fixture(days: number) {
  const dir = mkdtempSync(join(tmpdir(), 'gp-backups-'));
  mkdirSync(join(dir, 'nightly'));
  const now = Date.now();
  for (let d = 0; d < days; d++) {
    const t = new Date(now - d * 86_400_000);
    const stamp = t.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const f = join(dir, 'nightly', `goldplus-prod-nightly-${stamp}.dump`);
    writeFileSync(f, 'x');
    utimesSync(f, t, t);
  }
  writeFileSync(join(dir, 'goldplus-prod-pre-x.dump'), 'x');
  writeFileSync(join(dir, 'pre-apt-empty.sql'), '');
  const old = new Date(now - 2 * 3_600_000);
  utimesSync(join(dir, 'pre-apt-empty.sql'), old, old);
  return dir;
}

const run = (dir: string) =>
  execFileSync('bash', [script], { env: { ...process.env, BACKUP_DIR: dir, STEWARD_BIN: '/nonexistent', PATH: '/usr/bin:/bin' }, encoding: 'utf8' });

describe('host-maintain.sh is a report, the Storage Steward owns reclamation', () => {
  it('changes nothing: every file is still there afterwards, the empty one is only named', () => {
    const dir = fixture(30);
    const before = readdirSync(join(dir, 'nightly')).length;
    const out = run(dir);
    expect(readdirSync(join(dir, 'nightly')).length).toBe(before);
    expect(existsSync(join(dir, 'pre-apt-empty.sql'))).toBe(true);
    expect(out).toContain('EMPTY file (not a backup)');
    expect(out).toContain('nightly sets: 30');
  });

  it('says loudly when no offsite copy exists, and when the nightly is stale or missing', () => {
    expect(run(fixture(1))).toContain("NONE — every backup is on the database's own disk");
    expect(run(fixture(0))).toContain('NO nightly dump found');
    const dir = fixture(1);
    writeFileSync(join(dir, '.offsite-target'), 'u123@u123.your-storagebox.de:goldplus');
    expect(run(dir)).toContain('offsite copy: u123@u123.your-storagebox.de:goldplus');
  });

  it('never deletes or prunes anything, and never asks for --apply', () => {
    const mt = read('scripts/host-maintain.sh');
    expect(mt).not.toMatch(/\brm -/);
    expect(mt).not.toMatch(/prune/);
    expect(mt).not.toMatch(/--apply/);
    expect(mt).not.toMatch(/-delete/);
  });
});

describe('the host stops filling between deploys', () => {
  const compose = read('docker-compose.production.yml');

  it('every service caps its container log at the Steward policy, 50 MB x 3 files', () => {
    const policy = read('ops/storage-steward/policy.yaml');
    expect(policy).toMatch(/log_max_size_mb: 50\b/);
    expect(policy).toMatch(/log_max_files: 3\b/);
    const servicesBlock = compose.slice(compose.indexOf('\nservices:\n'), compose.indexOf('\nvolumes:\n'));
    const services = servicesBlock.match(/^  [a-z-]+:\n/gm)?.length ?? 0;
    expect(services).toBeGreaterThanOrEqual(12);
    expect(compose.match(/logging: \*goldplus-logging/g)).toHaveLength(services);
    expect(compose).toContain('max-size: "50m"');
    expect(compose).toContain('max-file: "3"');
  });

  it('Prometheus retention is explicit, 7 days and 1 GB', () => {
    expect(compose).toContain("'--storage.tsdb.retention.time=7d'");
    expect(compose).toContain("'--storage.tsdb.retention.size=1GB'");
  });

  it('a deploy starts exactly one audit job in the background, the smoke, and no Lighthouse Watch', () => {
    const deploy = read('scripts/deploy-prod.sh');
    const block = deploy.slice(deploy.indexOf('# Post-roll measurement'));
    expect(block).toContain('run-in-container.sh --ad-hoc');
    expect(block).not.toMatch(/lighthouse-watch\.sh (deploy|cron)/);
    expect(block.match(/\) 9>&- &/g)).toHaveLength(1);
    expect(block).not.toMatch(/nohup/);
  });
});
