import '../config/env';
import { Registry } from '../infrastructure/Registry';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * Owner-directed reset-link issuance (2026-08-10).
 *
 * Email delivery is inert (the provider account returns 429 on every send), so
 * the reset link a forgotten-password request would have emailed never arrives.
 * This issues the same KIND of token as RequestPasswordResetUseCase — 32 bytes,
 * SHA-256 at rest, 60-minute TTL, prior tokens invalidated — and prints the URL
 * so the operator can hand it to the account holder, who sets their own
 * password at /reset-password. No password is ever created or seen here.
 *
 * It does NOT call that use case, because the use case deliberately returns a
 * generic result and never surfaces the raw token (it emails it). An earlier
 * version of this comment claimed it did, which was untrue and hid the fact
 * that the use case's own guards were being skipped. They are applied here
 * explicitly instead:
 *   - a DEACTIVATED account is refused. Without this the script would mint a
 *     working reset link for an account somebody had disabled on purpose.
 *   - the issuance is AUDITED against the operator who ran it, so handing out a
 *     reset link is never anonymous.
 * Rate limiting is not reproduced: this path is not reachable by the public,
 * and it refuses to run without a named operator.
 *
 * Usage:
 *   ACTOR_USER_ID=<admin uuid> RESET_EMAIL=user@example.com \
 *     npx tsx src/scripts/issue-password-reset-link.ts
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../infrastructure/db/client';
import { hashResetToken } from '../application/use-cases/identity/PasswordResetUseCases';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';

async function main(): Promise<void> {
  const email = String(process.env.RESET_EMAIL ?? '').trim().toLowerCase();
  if (!email.includes('@')) throw new Error('RESET_EMAIL must be the account email.');

  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) {
    throw new Error('ACTOR_USER_ID must be the uuid of the operator issuing this link.');
  }

  const rows = await db.execute(sql`select id, is_active from users where lower(email) = ${email} limit 1`);
  const arr = Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
  const userId = arr[0]?.id as string | undefined;
  if (!userId) throw new Error('No account with that email.');
  // The same refusal RequestPasswordResetUseCase makes. A disabled account was
  // disabled deliberately; a reset link is a way back into it.
  if (arr[0]?.is_active === false) {
    throw new Error('That account is deactivated. Re-activate it first if this is intended.');
  }

  // Same primitive as RequestPasswordResetUseCase: 32-byte base64url token,
  // SHA-256 at rest, 60-minute TTL, prior tokens invalidated. The consume path
  // (/reset-password) is untouched — the holder sets their own password.
  const repo = Registry.getInstance().accountRecoveryRepo;
  await repo.invalidateOutstanding(userId);
  const rawToken = randomBytes(32).toString('base64url');
  await repo.issueToken({
    userId,
    tokenHash: hashResetToken(rawToken),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    requestedIp: 'operator-console',
  });
  await new CreateAuditLogUseCase(Registry.getInstance().auditRepo).execute({
    actorId,
    action: 'PASSWORD_RESET_LINK_ISSUED_BY_OPERATOR',
    entity: 'user',
    entityId: userId,
    newState: { email, via: 'operator-console' },
  });

  console.log(`RESET_LINK: https://shopgoldplus.com/reset-password?token=${rawToken}`);
  console.log('Expires in 60 minutes; single use; the account holder sets their own password.');
}

main()
  .then(async () => { await endDbConnection(); process.exit(0); })
  .catch(async (error) => { console.error('FAILED:', error instanceof Error ? error.message : error); await endDbConnection(); process.exit(1); });
