import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeReturnTo } from '../../apps/web/src/lib/safeReturnTo';

/**
 * Two auth defects found by the 2026-08-27 audit and verified by hand.
 *
 * 1. AN OPEN REDIRECT AFTER SIGN-IN.
 *    Four sites carried `value.startsWith('/') && !value.startsWith('//')`,
 *    which reads as "same-site only" and is not: browsers follow the WHATWG
 *    relative-slash rule, where a BACKSLASH acts like a second slash, so
 *    `/\evil.com` resolves to `https://evil.com/`. A phishing link to
 *    /login?returnTo=/%5Cevil.com showed the real sign-in page, took real
 *    credentials, then handed the signed-in customer to the attacker.
 *
 * 2. A SIGNATURE IS NOT A LIVE SESSION.
 *    Only the ADMIN middleware loaded the user and honoured
 *    users.sessions_invalidated_after. The customer middleware and the
 *    `bearerUser` helper behind /auth/logout-all, /auth/sessions and /auth/mfa/*
 *    stopped at the signature. A customer password reset DOES stamp that cutoff,
 *    and reset-password.astro promises "you have been signed out on every
 *    device" — which, for customers, was false.
 */

const BACKSLASH_ATTACK = '/' + String.fromCharCode(92) + 'evil.com';

describe('safeReturnTo refuses everything that leaves our origin', () => {
  it('refuses the backslash escape that defeated the old guard', () => {
    // Proof the attack is real: this is what a browser resolves it to.
    expect(new URL(BACKSLASH_ATTACK, 'https://shopgoldplus.com').origin).toBe('https://evil.com');
    expect(safeReturnTo(BACKSLASH_ATTACK)).toBe('/account');
  });

  it('refuses protocol-relative, absolute and scheme-bearing values', () => {
    for (const bad of ['//evil.com', 'https://evil.com', 'http://evil.com', 'javascript:alert(1)']) {
      expect(safeReturnTo(bad), bad).toBe('/account');
    }
  });

  it('refuses control characters that could split a Location header', () => {
    for (const code of [0, 9, 10, 13, 32, 127]) {
      expect(safeReturnTo('/a' + String.fromCharCode(code) + 'b')).toBe('/account');
    }
  });

  it('refuses nothing at all, and falls back', () => {
    expect(safeReturnTo(null)).toBe('/account');
    expect(safeReturnTo('')).toBe('/account');
    expect(safeReturnTo(undefined, '/cart')).toBe('/cart');
  });

  it('still allows the ordinary destinations the site actually uses', () => {
    for (const good of ['/account', '/cart', '/checkout', '/account/loyalty', '/shop?a=1#top']) {
      expect(safeReturnTo(good), good).toBe(good);
    }
  });

  it('keeps a percent-encoded backslash as a plain path, which never escapes', () => {
    // %5C is not decoded into an authority separator, so it stays ours.
    expect(safeReturnTo('/%5Cevil.com')).toBe('/%5Cevil.com');
    expect(new URL('/%5Cevil.com', 'https://shopgoldplus.com').origin).toBe('https://shopgoldplus.com');
  });
});

describe('every redirect site uses the one helper', () => {
  const read = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');

  for (const page of [
    'apps/web/src/pages/login.astro',
    'apps/web/src/pages/register.astro',
    'apps/web/src/pages/auth/[provider]/start.ts',
    'apps/web/src/pages/auth/[provider]/callback.ts',
  ]) {
    it(`${page} imports and uses safeReturnTo`, () => {
      const src = read(page);
      expect(src).toMatch(/import \{ safeReturnTo \} from '(\.\.\/)+lib\/safeReturnTo';/);
      expect(src).toMatch(/safeReturnTo\(/);
    });

    it(`${page} no longer hand-rolls the broken guard`, () => {
      expect(read(page)).not.toMatch(/startsWith\('\/'\) && !\w+\.startsWith\('\/\/'\)/);
    });
  }
});

describe('a signature alone is never a live session', () => {
  const read = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');
  const guard = read('apps/api/src/interfaces/http/middleware/liveSession.ts');

  it('the shared guard loads the user and checks the revocation cutoff', () => {
    expect(guard).toMatch(/userRepo\.findById\(verified\.subject\)/);
    expect(guard).toMatch(/if \(!user\.isActive\)/);
    expect(guard).toMatch(/isInvalidatedByCutoff\(verified\.issuedAt, user\.sessionsInvalidatedAfter\)/);
  });

  for (const entry of [
    'apps/api/src/interfaces/http/middleware/customerSession.ts',
    'apps/api/src/interfaces/http/middleware/auth.ts',
    'apps/api/src/interfaces/http/routes/auth.ts',
  ]) {
    it(`${entry} resolves its principal through that guard`, () => {
      expect(read(entry)).toMatch(/resolveLiveSession\(/);
    });
  }

  it('no entry point settles for tokenSigner.verify on its own', () => {
    // The defect shape: verifying the signature and immediately trusting the
    // subject, without asking whether that account may still hold a session.
    for (const entry of [
      'apps/api/src/interfaces/http/middleware/customerSession.ts',
      'apps/api/src/interfaces/http/middleware/auth.ts',
    ]) {
      expect(read(entry)).not.toMatch(/tokenSigner\.verify\(/);
    }
  });

  it('signing out everywhere actually ends the access tokens too', () => {
    // Revoking the refresh families alone left every device's access token
    // verifying until its own TTL ran out, so "sign out on every device" was a
    // promise about refresh credentials that the thing authorising requests
    // ignored. Stamped in SessionService.logoutAll so logout-all,
    // account-disabled and both password-change paths all get it.
    const service = read('apps/api/src/infrastructure/security/SessionService.ts');
    const logoutAll = service.slice(service.indexOf('async logoutAll('));
    expect(logoutAll).toMatch(/this\.users\.invalidateSessionsAfter\(userId, now\)/);

    const port = read('apps/api/src/application/ports/IUserRepository.ts');
    expect(port).toMatch(/invalidateSessionsAfter\(userId: string, at: Date\): Promise<void>;/);

    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleUserRepository.ts');
    expect(repo).toMatch(/set\(\{ sessionsInvalidatedAfter: at \}\)/);
  });

  it('the promise the reset page makes is the one the API now keeps', () => {
    // If this sentence is ever removed the test should be revisited, not deleted:
    // the point is that the claim and the enforcement travel together.
    expect(read('apps/web/src/pages/reset-password.astro')).toMatch(/signed out on every device/);
  });
});
