import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Final-gate guard: configuration the deployment sets must actually be READ.
 *
 * The security pass found the API answering `Access-Control-Allow-Origin: *` to
 * any origin while `CORS_ORIGIN=https://shopgoldplus.com` sat in the environment
 * unread — a config that lies is worse than no config, because the operator
 * believes a control exists. This test pins both halves: the allowlist is derived
 * from the env, and the wide-open default never returns.
 */
const APP = path.resolve(__dirname, '../../apps/api/src/interfaces/http/app.ts');
const COMPOSE = path.resolve(__dirname, '../../docker-compose.production.yml');

describe('security configuration is honoured (not merely declared)', () => {
  const app = fs.readFileSync(APP, 'utf8');

  it('CORS is not the wide-open default', () => {
    expect(app, 'bare cors() allows every origin').not.toMatch(/app\.use\(\s*['"]\*['"]\s*,\s*cors\(\)\s*\)/);
  });

  it('the CORS allowlist is derived from the CORS_ORIGIN the deployment sets', () => {
    expect(app).toMatch(/process\.env\.CORS_ORIGIN/);
    expect(app).toMatch(/cors\(\s*\{[\s\S]*origin:/);
    const compose = fs.readFileSync(COMPOSE, 'utf8');
    expect(compose, 'compose must keep passing CORS_ORIGIN to the api service').toMatch(/CORS_ORIGIN=\$\{CORS_ORIGIN\}/);
  });

  it('no hand-escaped SQL identifier lists remain in repositories', () => {
    const repoDir = path.resolve(__dirname, '../../apps/api/src/infrastructure/db/repositories');
    const offenders = fs
      .readdirSync(repoDir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /replace\(\/'\/g,\s*"''"\)/.test(fs.readFileSync(path.join(repoDir, f), 'utf8')));
    expect(offenders, 'use parameterised binding (sql.join / inArray), never manual quote-doubling').toEqual([]);
  });
});
