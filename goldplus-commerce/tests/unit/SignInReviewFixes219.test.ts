import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { refreshMaxAgeSeconds, signInCookieHeaders } from '../../apps/web/src/lib/session';
import { socialSignInMessage } from '../../apps/web/src/lib/socialSignInMessages';
import { parseRecField } from '../../apps/web/src/lib/adminAiVisibility';

const web = (p: string) => readFileSync(resolve(__dirname, '../../apps/web/src', p), 'utf8');

describe('refresh cookie lifetime', () => {
  it('an unreadable or empty expiry is null, never NaN', () => {
    expect(refreshMaxAgeSeconds('not a date')).toBeNull();
    expect(refreshMaxAgeSeconds('')).toBeNull();
    expect(refreshMaxAgeSeconds(undefined)).toBeNull();
    expect(refreshMaxAgeSeconds(new Date(Date.now() + 3600_000).toISOString())).toBeGreaterThan(3500);
    expect(refreshMaxAgeSeconds(new Date(Date.now() - 3600_000).toISOString())).toBe(60);
  });

  it('the raw headers fall back to 7 days and set no refresh cookie for a bad expiry', () => {
    const headers = signInCookieHeaders({ token: 't', refreshToken: 'r', refreshExpiresAt: 'garbage' });
    expect(headers).toHaveLength(1);
    expect(headers[0]).toContain('Max-Age=604800');
    expect(headers.join()).not.toContain('NaN');
  });
});

describe('signing out clears the refresh cookie too', () => {
  it('password change, saved and account 401 paths use clearSignInCookies', () => {
    for (const page of ['pages/account/password.astro', 'pages/account/saved.astro', 'pages/account/index.astro']) {
      const src = web(page);
      expect(src, page).toContain('clearSignInCookies(Astro.cookies)');
      expect(src, page).not.toContain('SESSION_COOKIE_NAME, { path');
      expect(src, page).not.toContain('clearSessionCookie()');
    }
  });
});

describe('social sign-in messages', () => {
  it('inherited object names are not messages', () => {
    const general = socialSignInMessage('something_new');
    for (const code of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
      expect(socialSignInMessage(code)).toBe(general);
    }
  });
});

describe('AI Search recommendation forms', () => {
  it('a mangled rec field is null, not a thrown SyntaxError', () => {
    expect(parseRecField('{"title":')).toBeNull();
    expect(parseRecField(null)).toBeNull();
    expect(parseRecField('[1]')).toBeNull();
    expect(parseRecField('"x"')).toBeNull();
    expect(parseRecField('{"title":"t"}')).toEqual({ title: 't' });
  });

  it('both pages use the guarded parse and encode the project', () => {
    for (const page of ['pages/admin/ai-search/index.astro', 'pages/admin/ai-search/gaps.astro']) {
      const src = web(page);
      expect(src, page).toContain('parseRecField(form.get("rec"))');
      expect(src, page).not.toContain('JSON.parse(String(form.get("rec")');
      expect(src, page).not.toContain('&project=${project}');
    }
  });
});
