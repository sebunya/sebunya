import { Registry } from '../../../infrastructure/Registry';
import { isInvalidatedByCutoff } from '../../../domain/identity/SessionPolicy';

/**
 * Resolve a bearer token to a user who is still allowed to hold a session.
 *
 * WHAT WAS WRONG
 * Verifying the token's signature proves it was issued. It does NOT prove the
 * account still exists, is still enabled, or has not been signed out since.
 * Only the ADMIN middleware loaded the user and honoured
 * `users.sessions_invalidated_after`; the customer middleware and the
 * `bearerUser` helper behind /auth/logout-all, /auth/sessions and /auth/mfa/*
 * stopped at the signature.
 *
 * A customer password reset DOES stamp that cutoff (see
 * DrizzleAccountRecoveryRepository), and reset-password.astro tells the customer
 * "for your safety you have been signed out on every device, including any you
 * did not recognise". For customers that sentence was false: a token stolen
 * before the reset kept working against /account/me, /account/orders,
 * /account/addresses and the rest for the remainder of its seven-day life, and
 * resetting the password could not take it away.
 *
 * One rule, one place, so the three entry points cannot drift apart again.
 */

export type LiveSession =
  | { ok: true; user: { id: string; email: string; isActive: boolean } }
  | { ok: false; code: 'UNAUTHENTICATED'; message: string }
  | { ok: false; code: 'ACCOUNT_DISABLED'; message: string };

export function bearerTokenFrom(header: string | undefined | null): string | null {
  return header && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
}

export async function resolveLiveSession(token: string | null): Promise<LiveSession> {
  const unauthenticated = (message = 'A valid session is required.') =>
    ({ ok: false, code: 'UNAUTHENTICATED', message }) as const;

  if (!token) return unauthenticated();

  const registry = Registry.getInstance();
  const verified = await registry.tokenSigner.verify(token);
  if (!verified) return unauthenticated('Invalid or expired session.');

  const user = await registry.userRepo.findById(verified.subject);
  if (!user) return unauthenticated('User no longer exists.');
  if (!user.isActive) {
    return { ok: false, code: 'ACCOUNT_DISABLED', message: 'This account has been disabled.' };
  }

  // Immediate hard revocation: a token issued at or before the cutoff is dead
  // now, rather than when its TTL happens to run out.
  if (verified.issuedAt && isInvalidatedByCutoff(verified.issuedAt, user.sessionsInvalidatedAfter)) {
    return unauthenticated('This session has been revoked. Please sign in again.');
  }

  return { ok: true, user: { id: user.id, email: user.email, isActive: user.isActive } };
}
