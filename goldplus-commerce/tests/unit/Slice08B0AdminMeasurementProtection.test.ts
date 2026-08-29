import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSessionToken } from '../../apps/web/src/lib/session';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const measurementRoutes = [
  'apps/web/src/pages/admin/measurement/index.astro',
  'apps/web/src/pages/admin/measurement/attribution.astro',
  'apps/web/src/pages/admin/measurement/consent.astro',
  'apps/web/src/pages/admin/measurement/dlq.astro',
  'apps/web/src/pages/admin/measurement/control-tower/controlled-activation/live-review/index.astro',
  'apps/web/src/pages/admin/measurement/control-tower/controlled-activation/live-review/[id].astro',
] as const;

const routeSources = measurementRoutes.map(read);
const routeBundle = routeSources.join('\n');
const login = read('apps/web/src/pages/admin/login.astro');
const admin = read('apps/web/src/pages/admin/index.astro');
const session = read('apps/web/src/lib/session.ts');

describe('Slice 8-B0 admin Measurement route protection', () => {
  it('fails closed when the named admin session cookie is absent', () => {
    expect(readSessionToken(new Request('https://shopgoldplus.com/admin/measurement'))).toBeNull();
  });

  it('places a server-side session guard on every existing Measurement route', () => {
    for (const source of routeSources) {
      expect(source).toContain("import { readSessionToken }");
      expect(source).toContain('const token = readSessionToken(Astro.request)');
      expect(source).toContain('if (!token)');
      expect(source).toMatch(/return Astro\.redirect\('\/admin\/login\?returnTo=\/admin\/measurement[^']*', 303\)/);
    }
  });

  it('guards the Measurement landing route before its admin layout renders', () => {
    const source = routeSources[0];
    expect(source.indexOf('if (!token)')).toBeLessThan(source.indexOf('<AdminLayout'));
    expect(source.indexOf('return Astro.redirect')).toBeLessThan(source.indexOf('Measurement Control Tower'));
  });

  it('guards attribution, consent and DLQ routes before protected UI renders', () => {
    for (const source of routeSources.slice(1, 4)) {
      expect(source.indexOf('if (!token)')).toBeLessThan(source.indexOf('<AdminLayout'));
    }
  });

  it('guards live-review routes before any server-side admin API fetch', () => {
    for (const source of routeSources.slice(4)) {
      expect(source.indexOf('if (!token)')).toBeLessThan(source.indexOf('apiFetch('));
    }
  });

  it('keeps login public and preserves its local-admin return target validation', () => {
    expect(login).not.toContain('readSessionToken(Astro.request)');
    // Replaced by the shared safeReturnTo helper, still scoped to /admin.
    expect(login).toContain("safeReturnTo(returnTo, '/admin')");
  });

  it('preserves the existing protected Admin Trust Centre route', () => {
    expect(admin).toContain('const token = readSessionToken(Astro.request)');
    expect(admin).toContain('return Astro.redirect("/admin/login?returnTo=/admin", 303)');
  });

  it('reuses the existing session cookie contract without adding auth state', () => {
    expect(session).toContain("const COOKIE_NAME = 'goldplus_session'");
    expect(session).toContain("'HttpOnly'");
    expect(session).toContain("'SameSite=Lax'");
    expect(routeBundle).not.toMatch(/setCookie|sessionCookieValue|newSession|createSession/);
  });

  it('does not add client-side authorization as a substitute for the server guard', () => {
    expect(routeBundle).not.toMatch(/window\.location.*admin\/login|document\.cookie.*goldplus_session/);
  });

  it('does not change Measurement transport, destination or provider code', () => {
    expect(routeBundle).not.toMatch(/activateProvider|rotateCredential|dispatchEvent|destinationRouter|outbox\.enqueue/);
  });

  it('does not introduce checkout, payment, loyalty or recommendation coupling', () => {
    expect(routeBundle).not.toMatch(/PesaPal|checkout amount|loyalty-foundation|recommendations\.ts|issueReward|sendWhatsApp/);
  });

  it('uses 303 redirects and never renders an access-denied page after protected content', () => {
    const redirects = routeBundle.match(/Astro\.redirect\([^\n]+, 303\)/g) ?? [];
    expect(redirects).toHaveLength(measurementRoutes.length);
    expect(routeBundle).not.toContain('status: 200, accessDenied: true');
  });
});
