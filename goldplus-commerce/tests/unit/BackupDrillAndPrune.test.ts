import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(__dirname, '../..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');
const steward = join(root, 'ops/storage-steward/goldplus-storage-steward');

/** A fake `docker` whose `builder prune --help` offers `flag`, whose prune exits `pruneCode`,
 *  and whose build cache is 16 GB before a prune and `afterGb` after. Calls are logged. */
function fakeDocker(flag: string, pruneCode: number, afterGb: number) {
  const bin = mkdtempSync(join(tmpdir(), 'gp-docker-'));
  const log = join(bin, 'calls.log');
  const state = join(bin, 'pruned');
  writeFileSync(join(bin, 'docker'), `#!/bin/sh
echo "$*" >> ${log}
case "$*" in
  "builder prune --help") echo "      ${flag} bytes   bound";;
  "system df --format {{json .}}") if [ -f ${state} ]; then echo '{"Type":"Build Cache","Size":"${afterGb}GB"}'; else echo '{"Type":"Build Cache","Size":"16GB"}'; fi;;
  builder\\ prune\\ -f*) touch ${state}; [ ${pruneCode} = 0 ] || { echo "unknown flag: --keep-storage" >&2; exit ${pruneCode}; };;
esac
`);
  chmodSync(join(bin, 'docker'), 0o755);
  return { bin, log };
}

const py = (body: string, path: string) =>
  execFileSync('python3', ['-c', `
import importlib.machinery, importlib.util, sys
loader = importlib.machinery.SourceFileLoader('steward', ${JSON.stringify(steward)})
spec = importlib.util.spec_from_loader('steward', loader)
m = importlib.util.module_from_spec(spec); sys.modules['steward'] = m; loader.exec_module(m)
class S:
    alerts = []
    def record_alert(self, sev, cause, detail): self.alerts.append(sev + ':' + cause)
st = S()
policy = {"docker": {"build_cache_max_gb": 2}}
${body}
`], { env: { ...process.env, PATH: `${path}:/usr/bin:/bin` }, encoding: 'utf8' }).trim();

describe('the Steward prunes build cache with the flag this Docker has, and says when it fails', () => {
  it('Docker 29: uses --max-used-space, re-measures, and reports the real result', () => {
    const { bin, log } = fakeDocker('--max-used-space', 0, 1);
    const out = py(`print(m.prune_build_cache(policy, True, st)[1]); print(st.alerts)`, bin);
    expect(readFileSync(log, 'utf8')).toMatch(/builder prune -f --max-used-space 2147483648/);
    expect(out).toContain('--max-used-space, bound 2 GB');
    expect(out).toContain('[]');
  });

  it('older Docker: falls back to --keep-storage', () => {
    const { bin, log } = fakeDocker('--keep-storage', 0, 1);
    py(`m.prune_build_cache(policy, True, st)`, bin);
    expect(readFileSync(log, 'utf8')).toMatch(/builder prune -f --keep-storage 2147483648/);
  });

  it('a failing prune is reported as FAILED and raises a HIGH alert, never "trimmed"', () => {
    const { bin } = fakeDocker('--max-used-space', 1, 16);
    const out = py(`print(m.prune_build_cache(policy, True, st)[1]); print(st.alerts)`, bin);
    expect(out).toContain('build cache prune FAILED');
    expect(out).toContain('HIGH:build cache prune failed');
    expect(out).not.toContain('trimmed');
  });

  it('a prune that leaves the cache over its bound raises a WATCH alert', () => {
    const { bin } = fakeDocker('--max-used-space', 0, 9);
    const out = py(`print(m.prune_build_cache(policy, True, st)[1]); print(st.alerts)`, bin);
    expect(out).toContain('still above its 2 GB bound');
    expect(out).toContain('WATCH:build cache still over bound after prune');
  });

  it('dry run never calls prune', () => {
    const { bin, log } = fakeDocker('--max-used-space', 0, 1);
    py(`m.prune_build_cache(policy, False, st)`, bin);
    expect(readFileSync(log, 'utf8')).not.toMatch(/builder prune -f/);
  });
});

describe('the restore drill proves the offsite copy becomes a working database', () => {
  const drill = read('ops/backup/restore-drill.sh');

  it('restores into a throwaway database on a private network and always cleans up', () => {
    expect(drill).toMatch(/docker network create "\$NET"/);
    expect(drill).toMatch(/trap cleanup EXIT/);
    expect(drill).toMatch(/docker rm -f -v "\$DB"/);
    expect(drill).not.toMatch(/pg_restore[^\n]*goldplus-commerce-postgres-1/);
  });

  it('compares with live: table count equal, five largest tables never above live and not below the floor', () => {
    expect(drill).toContain('table count differs');
    expect(drill).toMatch(/order by n_live_tup desc limit 5/);
    expect(drill).toContain('MORE rows restored');
    expect(drill).toMatch(/DRILL_MIN_RATIO:-0\.90/);
  });

  it('pulls the newest dump from the Storage Box by default, and can drill the local copy', () => {
    expect(drill).toMatch(/rsync -e "\$E" --timeout=600 "\$TARGET\/nightly\/\$NEWEST"/);
    expect(drill).toContain('--local');
  });

  it('runs monthly after the dump and the offsite copy', () => {
    expect(read('ops/backup/goldplus-restore-drill.timer')).toMatch(/OnCalendar=Sun \*-\*-1\.\.7 03:30:00 UTC/);
  });
});

describe('a backup job that fails tells someone', () => {
  it.each(['goldplus-pg-backup.service', 'goldplus-offsite-sync.service', 'goldplus-restore-drill.service'])(
    '%s has OnFailure → goldplus-alert@', (unit) => {
      expect(read(`ops/backup/${unit}`)).toContain('OnFailure=goldplus-alert@%n.service');
    });

  it('the alert unit only calls alert.sh: no shell inside the unit for systemd to mangle', () => {
    const a = read('ops/backup/goldplus-alert@.service');
    expect(a).toMatch(/^ExecStart=\/opt\/goldplus\/app\/goldplus-commerce\/ops\/backup\/alert\.sh %i$/m);
    expect(a).not.toMatch(/\$\(|\$[A-Z_]/);
  });
});

describe('offsite-sync.sh reads REAL rsync listings, in tests and in production alike', () => {
  const s = read('ops/backup/offsite-sync.sh');
  it('one parser, keyed on the file-type character, used by both modes', () => {
    expect(s).toMatch(/parse_rsync_listing\(\) \{ awk '\/\^-\/ \{ gsub\(",", "", \$2\); print \$2, \$NF \}'/);
    expect(s.match(/--list-only[^\n]*\| parse_rsync_listing/g)).toHaveLength(2);
  });
});

describe('ops/backup/alert.sh reaches a person, and says honestly when it did not', () => {
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const http = require('node:http') as typeof import('node:http');
  const alert = join(root, 'ops/backup/alert.sh');
  const run = (env: Record<string, string>) =>
    spawnSync('bash', [alert, 'goldplus-pg-backup.service'], { env: { ...process.env, ALERT_ENV_FILE: '/nonexistent', ...env }, encoding: 'utf8' });

  it('posts the unit name to the webhook', async () => {
    let body = '';
    const server = http.createServer((req, res) => { req.on('data', (c) => { body += c; }); req.on('end', () => { res.end('ok'); }); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as any).port;
    const r = await new Promise<ReturnType<typeof run>>((resolveRun) => {
      const { spawn } = require('node:child_process') as typeof import('node:child_process');
      let out = '';
      const p = spawn('bash', [alert, 'goldplus-pg-backup.service'], { env: { ...process.env, ALERT_ENV_FILE: '/nonexistent', ALERT_WEBHOOK_URL: `http://127.0.0.1:${port}/t` } });
      p.stdout.on('data', (c) => { out += c; });
      p.on('close', (code) => resolveRun({ status: code, stdout: out } as any));
    });
    server.close();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('SENT: [goldplus-prod CRITICAL] goldplus-pg-backup.service failed');
    expect(body).toContain('goldplus-pg-backup.service failed');
  });

  it('a refused webhook is reported as SEND FAILED, never as "no URL"', () => {
    const r = run({ ALERT_WEBHOOK_URL: 'http://127.0.0.1:9/nothing-listens' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('SEND FAILED');
  });

  it('no webhook: NOT SENT, and why', () => {
    const r = run({ ALERT_WEBHOOK_URL: '' });
    expect(r.stdout).toContain('NOT SENT (no ALERT_WEBHOOK_URL');
  });

  it('reads the URL from the secrets file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-alert-'));
    writeFileSync(join(dir, 'alerts.env'), 'ALERT_WEBHOOK_URL="http://127.0.0.1:9/x"\n');
    const r = spawnSync('bash', [alert, 'u'], { env: { ...process.env, ALERT_WEBHOOK_URL: '', ALERT_ENV_FILE: join(dir, 'alerts.env') }, encoding: 'utf8' });
    expect(r.stdout).toContain('SEND FAILED');
  });
});
