import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formPostRelayLocation, FORM_POST_RELAY_PATH } from '../../apps/api/src/domain/identity/SocialProvider';
import { decideCsrf, isCsrfExempt } from '../../apps/api/src/domain/security/CsrfPolicy';

/**
 * Apple returns sign-in results as a cross-site form POST. The storefront's SameSite=Lax flow cookie is not sent on
 * it and the website's origin check refuses it, so Apple sign-in could never complete. The API now receives that
 * POST and redirects the browser (303) to the storefront callback as a GET carrying the code and state only.
 */
describe('the Apple form-post relay', () => {
  it('forwards code, state and error only; never Apple\'s user field or an id_token', () => {
    const loc = formPostRelayLocation('https://shopgoldplus.com/', 'apple', {
      code: 'c.123', state: 's-456', user: '{"name":{"firstName":"A"},"email":"a@b.com"}', id_token: 'eyJ...', extra: 'x',
    });
    const url = new URL(loc);
    expect(`${url.origin}${url.pathname}`).toBe('https://shopgoldplus.com/auth/apple/callback');
    expect(Object.fromEntries(url.searchParams)).toEqual({ code: 'c.123', state: 's-456' });
    expect(new URL(formPostRelayLocation('https://shopgoldplus.com', 'apple', { error: 'user_cancelled_authorize', state: 's' })).searchParams.get('error')).toBe('user_cancelled_authorize');
  });

  it('answers a real POST with a 303 to the storefront callback, and refuses a provider that does not POST', async () => {
    const routes = (await import('../../apps/api/src/interfaces/http/routes/auth-social')).default;
    const res = await routes.request('/apple/form-post', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'code=abc&state=xyz&user=%7B%22name%22%3A%22A%22%7D',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toMatch(/\/auth\/apple\/callback\?code=abc&state=xyz$/);
    expect((await routes.request('/google/form-post', { method: 'POST' })).status).toBe(404);
  }, 120_000); // importing the routes loads the whole registry

  it('is exempt from the CSRF guard by exact path only (it changes nothing; Apple sends no allowlisted origin)', () => {
    expect(isCsrfExempt(FORM_POST_RELAY_PATH('apple'))).toBe(true);
    expect(isCsrfExempt('/auth/social/apple/form-post/x')).toBe(false);
    expect(isCsrfExempt('/auth/social/apple/exchange')).toBe(false);
    expect(decideCsrf({ method: 'POST', path: '/auth/social/apple/form-post', cookieHeader: '__cf_bm=1', originHeader: 'https://appleid.apple.com', refererHeader: null, allowlist: ['https://shopgoldplus.com'] })).toEqual({ action: 'ALLOW' });
  });

  it('Apple is sent to the relay for both the authorize request and the code exchange', () => {
    const src = readFileSync(join(__dirname, '../../apps/api/src/interfaces/http/routes/auth-social.ts'), 'utf8');
    expect(src).toMatch(/OIDC_PROVIDERS\[provider\]\.responseMode === 'form_post'\s*\?\s*`\$\{publicApiBase\(\)\}\$\{FORM_POST_RELAY_PATH\(provider\)\}`/);
    expect(src.match(/redirectUri: redirectUriFor\(provider\)/g)?.length).toBe(2);
  });
});
