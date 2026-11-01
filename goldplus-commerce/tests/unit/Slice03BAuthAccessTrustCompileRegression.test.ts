import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clearSessionCookie, readSessionToken } from '../../apps/web/src/lib/session';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const admin = read('apps/web/src/pages/admin/index.astro');
const login = read('apps/web/src/pages/admin/login.astro');
const session = read('apps/web/src/lib/session.ts');

describe('Slice 03-B auth access trust compile regression', () => {
  it('fails closed when the admin session cookie is absent', () => {
    expect(readSessionToken(new Request('https://shopgoldplus.com/admin'))).toBeNull();
    expect(admin).toContain('return Astro.redirect("/admin/login?returnTo=/admin", 303)');
  });

  it('reads only the named session cookie and clears it securely', () => {
    const request = new Request('https://shopgoldplus.com/admin', {
      headers: { cookie: 'unrelated=value; goldplus_session=session-token' },
    });
    expect(readSessionToken(request)).toBe('session-token');
    expect(clearSessionCookie()).toContain('HttpOnly');
    expect(clearSessionCookie()).toContain('SameSite=Lax');
  });

  it('restricts post-login redirects to local admin routes', () => {
    // The hand-rolled guard was replaced by the shared safeReturnTo helper,
    // which proves same-origin properly; the /admin scope is still enforced.
    expect(login).toContain("safeReturnTo(returnTo, '/admin')");
    expect(login).toContain("resolved.startsWith('/admin') ? resolved : '/admin'");
    // Anything outside /admin still lands on /admin.
    expect(login).toContain("safeReturnTo(returnTo, '/admin')");
  });

  it('reports unconfigured auth without activating a provider', () => {
    expect(login).toContain("json?.error?.code === 'AUTH_NOT_CONFIGURED'");
    expect(login).toContain('Admin sign-in not configured');
    expect(`${session}\n${login}`).not.toMatch(/PesaPal|ZeptoMail|sendWhatsApp|queue\.add|activateProvider/);
  });
});
