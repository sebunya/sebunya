import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const adminRoot = resolve(root, 'apps/web/src/pages/admin');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');
const toRepoPath = (file: string) => relative(root, file).replaceAll('\\', '/');

const discoverAstroPages = (directory: string): string[] =>
  readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory() ? discoverAstroPages(path) : [path];
    })
    .filter((path) => path.endsWith('.astro'))
    .map(toRepoPath)
    .sort();

const adminPages = discoverAstroPages(adminRoot);
const publicAllowlist = ['apps/web/src/pages/admin/login.astro'] as const;
const knownExposedRoutes = [
  ['apps/web/src/pages/admin/controlled-activation-dry-run.astro', '/admin/controlled-activation-dry-run', 'Controlled Activation Dry-Run Orchestrator'],
  ['apps/web/src/pages/admin/controlled-activation.astro', '/admin/controlled-activation', 'Controlled Activation Governance'],
  ['apps/web/src/pages/admin/controlled-live-canary.astro', '/admin/controlled-live-canary', 'Controlled Live Canary Activation'],
  ['apps/web/src/pages/admin/measurement-handover.astro', '/admin/measurement-handover', 'Phase 2 Operational Handover'],
  ['apps/web/src/pages/admin/release-readiness.astro', '/admin/release-readiness', 'Release Readiness - Measurement Control Tower'],
] as const;
const measurementRoutes = [
  'apps/web/src/pages/admin/measurement/index.astro',
  'apps/web/src/pages/admin/measurement/attribution.astro',
  'apps/web/src/pages/admin/measurement/consent.astro',
  'apps/web/src/pages/admin/measurement/dlq.astro',
  'apps/web/src/pages/admin/measurement/control-tower/controlled-activation/live-review/index.astro',
  'apps/web/src/pages/admin/measurement/control-tower/controlled-activation/live-review/[id].astro',
] as const;

const guardIndex = (source: string) => source.indexOf('readSessionToken(Astro.request)');
const redirectIndex = (source: string) => source.indexOf('return Astro.redirect');

describe('Slice 8-B1 deny-by-default admin route protection contract', () => {
  it('discovers the complete current admin Astro inventory', () => {
    // 87 = 84 at slice 8-B1 + platform-modules (U-programme) + media (Wave 2B)
    // + loyalty/gamification (§32 tail). The old flat admin/legal.astro was removed
    // when the CMS workspace superseded it. 90 = 88 + the delivery Control Centre
    // and its launch wizard (delivery brief v7); 91 adds the calibration surface;
    // 92 adds product-costs (2026-08-07) — the cost-entry surface whose absence
    // made "enter costs to activate profit" a promise with nowhere to keep it.
    // 93 adds hero (2026-08-07) — the homepage hero editor.
    // 94 adds nav (2026-08-07) — the header/navigation editor (Stage 2 CMS).
    expect(adminPages).toHaveLength(94);
    expect(adminPages[0]).toBe('apps/web/src/pages/admin/analytics/index.astro');
    expect(adminPages.at(-1)).toBe('apps/web/src/pages/admin/verification/index.astro');
  });

  it('keeps the public admin allowlist explicit and limited to login', () => {
    expect(publicAllowlist).toEqual(['apps/web/src/pages/admin/login.astro']);
  });

  it('keeps /admin/login public and preserves safe local return targets', () => {
    const login = read(publicAllowlist[0]);
    expect(login).not.toContain('readSessionToken(Astro.request)');
    expect(login).toContain("returnTo.startsWith('/admin') && !returnTo.startsWith('//')");
  });

  it('fails closed for every non-allowlisted admin Astro page', () => {
    const protectedPages = adminPages.filter((page) => !publicAllowlist.includes(page as typeof publicAllowlist[number]));
    expect(protectedPages).toHaveLength(93);
    for (const page of protectedPages) {
      const source = read(page);
      expect(source, `${page} must use the server-side session contract`).toContain('readSessionToken(Astro.request)');
      expect(source, `${page} must redirect logged-out requests`).toContain('return Astro.redirect');
      expect(source, `${page} must redirect with 303`).toMatch(/Astro\.redirect\([\s\S]*?, 303\)/);
    }
  });

  it('makes unknown future admin pages fail by deriving the inventory from disk', () => {
    const classified = new Set([...publicAllowlist, ...adminPages.filter((page) => !publicAllowlist.includes(page as typeof publicAllowlist[number]))]);
    expect([...adminPages].filter((page) => !classified.has(page))).toEqual([]);
  });

  it.each(knownExposedRoutes)('guards repaired route %s server-side', (file) => {
    const source = read(file);
    expect(source).toContain("import { readSessionToken } from '../../lib/session'");
    expect(source).toContain('const token = readSessionToken(Astro.request)');
    expect(source).toContain('if (!token)');
  });

  it.each(knownExposedRoutes)('redirects repaired route %s to its safe return target', (file, route) => {
    expect(read(file)).toContain(`return Astro.redirect('/admin/login?returnTo=${route}', 303)`);
  });

  it.each(knownExposedRoutes)('guards repaired route %s before protected marker %s', (file, _route, marker) => {
    const source = read(file);
    expect(guardIndex(source)).toBeGreaterThan(-1);
    expect(redirectIndex(source)).toBeGreaterThan(guardIndex(source));
    expect(redirectIndex(source)).toBeLessThan(source.indexOf(marker));
  });

  it.each(measurementRoutes)('preserves the 8-B0A guard on %s', (file) => {
    const source = read(file);
    expect(source).toContain('readSessionToken(Astro.request)');
    expect(source).toMatch(/return Astro\.redirect\('\/admin\/login\?returnTo=\/admin\/measurement[^']*', 303\)/);
  });

  it('keeps every dynamic admin route explicitly guarded', () => {
    const dynamicPages = adminPages.filter((page) => page.includes('['));
    expect(dynamicPages).toHaveLength(19);
    for (const page of dynamicPages) {
      expect(read(page), `${page} requires source-level protection`).toContain('readSessionToken(Astro.request)');
    }
  });

  it('does not use client-side redirects as an authorization substitute', () => {
    const repaired = knownExposedRoutes.map(([file]) => read(file)).join('\n');
    expect(repaired).not.toMatch(/window\.location.*admin\/login|document\.cookie.*goldplus_session/);
  });

  it('does not introduce auth state or RBAC semantics in repaired routes', () => {
    const repaired = knownExposedRoutes.map(([file]) => read(file)).join('\n');
    expect(repaired).not.toMatch(/setCookie|createSession|newSession|permission|roleId|rbac/i);
  });

  it('keeps the worktree clear of forbidden implementation areas', () => {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
    const changedAppFiles = status
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).split(' -> ').at(-1) ?? '')
      .filter((file) => file.startsWith('apps/'));
    expect(changedAppFiles).not.toContain('apps/web/src/lib/session.ts');
    expect(changedAppFiles).not.toMatchObject(expect.arrayContaining([expect.stringMatching(/apps\/api|checkout|payment|pesapal|provider|queue|outbox|loyalty|recommendation/i)]));
  });

  it('limits repaired route imports to the existing session reader', () => {
    for (const [file] of knownExposedRoutes) {
      const source = read(file);
      expect(source).toContain("from '../../lib/session'");
      expect(source).not.toContain('middleware');
    }
  });

  it('keeps all known protected marker construction after the redirect', () => {
    for (const [file, _route, marker] of knownExposedRoutes) {
      const source = read(file);
      expect(redirectIndex(source)).toBeLessThan(source.indexOf(marker));
      expect(redirectIndex(source)).toBeLessThan(source.indexOf('<'));
    }
  });

  /**
   * Non-Astro files under the admin page directory are endpoints, not pages,
   * so the "redirect before you render" contract the rest of this suite
   * enforces does not apply to them. Each one must therefore be named here
   * with the reason it is safe. The default stays deny: anything that appears
   * without being classified fails this test.
   */
  const classifiedAdminEndpoints = new Map<string, string>([
    [
      'logout.ts',
      'Sign-out endpoint. Reads no admin data and renders nothing, so it has ' +
        'no protected surface to leak; it revokes the token server-side and ' +
        'clears the HttpOnly cookie with Set-Cookie, which page-level Astro ' +
        'frontmatter cannot do. Unauthenticated calls are a no-op that ' +
        'redirect to the login screen.',
    ],
  ]);

  it('contains no unclassified non-Astro page inside the admin page directory', () => {
    const allFiles = readdirSync(adminRoot, { recursive: true })
      .map((entry) => resolve(adminRoot, String(entry)))
      .filter((path) => statSync(path).isFile())
      .map((path) => basename(path));
    const unclassified = allFiles.filter(
      (file) => !file.endsWith('.astro') && !classifiedAdminEndpoints.has(file),
    );
    expect(unclassified, `unclassified non-Astro admin files: ${unclassified.join(', ')}`).toEqual([]);
  });

  it('every classified admin endpoint carries the reason it is exempt', () => {
    for (const [file, reason] of classifiedAdminEndpoints) {
      expect(reason.length, `${file} needs a real justification`).toBeGreaterThan(80);
    }
  });
});
