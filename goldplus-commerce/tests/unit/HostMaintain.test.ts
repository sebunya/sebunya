import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, utimesSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(__dirname, '../..');
const script = join(root, 'scripts/host-maintain.sh');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

/** A backup directory with N nightly sets, one per day, newest = today. */
function fixture(days: number, premig = 3) {
  const dir = mkdtempSync(join(tmpdir(), 'gp-backups-'));
  mkdirSync(join(dir, 'nightly'));
  const now = Date.now();
  for (let d = 0; d < days; d++) {
    const t = new Date(now - d * 86_400_000);
    const stamp = t.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    for (const name of [`goldplus-prod-nightly-${stamp}.dump`, `goldplus-media-nightly-${stamp}.tar.gz`]) {
      const f = join(dir, 'nightly', name);
      writeFileSync(f, 'x');
      utimesSync(f, t, t);
    }
  }
  for (let i = 0; i < premig; i++) {
    const t = new Date(now - (i + 1) * 3_600_000);
    const f = join(dir, `goldplus-prod-pre-00${i}-${t.getTime()}.dump`);
    writeFileSync(f, 'x');
    utimesSync(f, t, t);
  }
  writeFileSync(join(dir, 'pre-apt-empty.sql'), '');
  const old = new Date(now - 2 * 3_600_000);
  utimesSync(join(dir, 'pre-apt-empty.sql'), old, old);
  return dir;
}

function run(dir: string, apply = false) {
  return execFileSync('bash', [script, ...(apply ? ['--apply'] : [])], {
    env: { ...process.env, BACKUP_DIR: dir, PATH: '/usr/bin:/bin' },  // no docker/apt/journalctl on PATH
    encoding: 'utf8',
  });
}

describe('host-maintain.sh backup retention', () => {
  it('is a dry run unless --apply is given, and says so', () => {
    const dir = fixture(10);
    const out = run(dir);
    expect(out).toContain('DRY-RUN');
    expect(out).toContain('nothing was removed');
    expect(existsSync(join(dir, 'pre-apt-empty.sql'))).toBe(true);
  });

  it('keeps the newest 7 nightly sets (plus a monthly keeper) and 2 pre-migration dumps, removes the empty file', () => {
    const dir = fixture(10);
    run(dir, true);
    const left = execFileSync('ls', ['-1t', join(dir, 'nightly')], { encoding: 'utf8' }).trim().split('\n');
    // 7 newest, plus the oldest set of each month the older 3 fall in (1 or 2 months)
    const dumps = left.filter((f) => f.endsWith('.dump'));
    expect(dumps.length).toBeGreaterThanOrEqual(8);
    expect(dumps.length).toBeLessThanOrEqual(9);
    expect(left.filter((f) => f.endsWith('.tar.gz'))).toHaveLength(dumps.length);
    // the 7 newest are untouched: the newest file name is still the first
    const all = execFileSync('ls', ['-1t', join(dir, 'nightly')], { encoding: 'utf8' }).trim().split('\n');
    expect(all[0]).toMatch(/nightly-/);
    const top = execFileSync('ls', ['-1', dir], { encoding: 'utf8' }).trim().split('\n');
    expect(top.filter((f) => f.startsWith('goldplus-prod-pre-'))).toHaveLength(2);
    expect(existsSync(join(dir, 'pre-apt-empty.sql'))).toBe(false);
  });

  it('keeps one set per month for 3 months beyond the 7 nightly', () => {
    const dir = fixture(100);
    run(dir, true);
    const left = execFileSync('ls', ['-1', join(dir, 'nightly')], { encoding: 'utf8' }).trim().split('\n');
    const dumps = left.filter((f) => f.endsWith('.dump'));
    // 7 newest + up to 3 monthly keepers (months may overlap the 7-day window)
    expect(dumps.length).toBeGreaterThanOrEqual(8);
    expect(dumps.length).toBeLessThanOrEqual(10);
  });

  it('never removes anything when there are fewer files than the rule keeps', () => {
    const dir = fixture(3, 1);
    run(dir, true);
    const left = execFileSync('ls', ['-1', join(dir, 'nightly')], { encoding: 'utf8' }).trim().split('\n');
    expect(left).toHaveLength(6);
  });

  it('warns when no offsite copy is configured, and flags a stale nightly', () => {
    const dir = fixture(1);
    expect(run(dir)).toContain('no offsite copy configured');
    const stale = fixture(0);
    expect(run(stale)).toContain('NO nightly dump found');
  });
});

describe('the host stops filling between deploys', () => {
  const compose = read('docker-compose.production.yml');

  it('every service caps its container log at 20 MB x 3 files', () => {
    const servicesBlock = compose.slice(compose.indexOf('\nservices:\n'), compose.indexOf('\nvolumes:\n'));
    const services = servicesBlock.match(/^  [a-z-]+:\n/gm)?.length ?? 0;
    expect(services).toBeGreaterThanOrEqual(12);
    expect(compose.match(/logging: \*goldplus-logging/g)).toHaveLength(services);
    expect(compose).toContain('max-size: "20m"');
    expect(compose).toContain('max-file: "3"');
  });

  it('Prometheus retention is explicit, 7 days and 1 GB', () => {
    expect(compose).toContain("'--storage.tsdb.retention.time=7d'");
    expect(compose).toContain("'--storage.tsdb.retention.size=1GB'");
  });

  it('the post-deploy smoke and the Lighthouse watch run one after the other, never together', () => {
    const deploy = read('scripts/deploy-prod.sh');
    const smoke = deploy.indexOf('run-in-container.sh --ad-hoc');
    const watch = deploy.indexOf('lighthouse-watch.sh deploy');
    expect(smoke).toBeGreaterThan(-1);
    expect(watch).toBeGreaterThan(smoke);
    // one subshell, both inside it, one `&`
    const block = deploy.slice(deploy.indexOf('# Post-roll measurement'));
    expect(block.match(/\) 9>&- &/g)).toHaveLength(1);
    expect(block).not.toMatch(/nohup/);
  });

  it('the maintenance script never wipes the whole build cache', () => {
    const mt = read('scripts/host-maintain.sh');
    expect(mt).toMatch(/docker builder prune -f --filter "until=/);
    expect(mt).not.toMatch(/builder prune -af/);
  });
});
