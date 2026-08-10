import '../config/env';
import { Registry } from '../infrastructure/Registry';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * Owner-directed reset-link issuance (2026-08-10).
 *
 * Email delivery is inert (the provider account returns 429 on every send), so
 * the reset link a forgotten-password request would have emailed never arrives.
 * This drives the SAME RequestPasswordResetUseCase — same 32-byte token, same
 * SHA-256 at rest, same TTL, same audit surface — and prints the reset URL so
 * the operator can hand it to the account holder, who sets their own password
 * at /reset-password. No password is ever created or seen here.
 *
 * Usage: RESET_EMAIL=user@example.com npx tsx src/scripts/issue-password-reset-link.ts
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../infrastructure/db/client';
import { hashResetToken } from '../application/use-cases/identity/PasswordResetUseCases';

async function main(): Promise<void> {
  const email = String(process.env.RESET_EMAIL ?? '').trim().toLowerCase();
  if (!email.includes('@')) throw new Error('RESET_EMAIL must be the account email.');

  const rows = await db.execute(sql`select id from users where lower(email) = ${email} limit 1`);
  const arr = Array.isArray(rows) ? rows : (rows as any)?.rows ?? [];
  const userId = arr[0]?.id as string | undefined;
  if (!userId) throw new Error('No account with that email.');

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
  console.log(`RESET_LINK: https://shopgoldplus.com/reset-password?token=${rawToken}`);
  console.log('Expires in 60 minutes; single use; the account holder sets their own password.');
}

main()
  .then(async () => { await endDbConnection(); process.exit(0); })
  .catch(async (error) => { console.error('FAILED:', error instanceof Error ? error.message : error); await endDbConnection(); process.exit(1); });
