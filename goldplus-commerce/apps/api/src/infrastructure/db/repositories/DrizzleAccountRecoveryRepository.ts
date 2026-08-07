import { sql } from 'drizzle-orm';
import { db } from '../client';
import type {
  IAccountRecoveryRepository,
  IssuedResetToken,
  ResolvedResetToken,
} from '../../../application/ports/IAccountRecoveryRepository';

const rowsOf = (result: any): any[] => (Array.isArray(result) ? result : result?.rows ?? []);

/**
 * Account recovery storage (0106).
 *
 * `consumeAndSetPassword` is the important one: consuming the token, writing
 * the new hash and revoking existing sessions happen in ONE transaction, and
 * the consume is conditional on the token still being unconsumed. Two clicks
 * on the same link race into the same UPDATE; exactly one sees a row.
 */
export class DrizzleAccountRecoveryRepository implements IAccountRecoveryRepository {
  async issueToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    requestedIp: string | null;
  }): Promise<IssuedResetToken> {
    const rows = rowsOf(
      await db.execute(sql`
        insert into password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
        values (${input.userId}::uuid, ${input.tokenHash}, ${input.expiresAt.toISOString()}::timestamptz, ${input.requestedIp})
        returning id, user_id, expires_at
      `),
    );
    const row = rows[0];
    return { id: String(row.id), userId: String(row.user_id), expiresAt: new Date(row.expires_at) };
  }

  async findByTokenHash(tokenHash: string): Promise<ResolvedResetToken | null> {
    const rows = rowsOf(
      await db.execute(sql`
        select t.id, t.user_id, t.expires_at, t.consumed_at, u.email
        from password_reset_tokens t
        join users u on u.id = t.user_id
        where t.token_hash = ${tokenHash}
        limit 1
      `),
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: String(row.id),
      userId: String(row.user_id),
      email: String(row.email),
      expiresAt: new Date(row.expires_at),
      consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
    };
  }

  async consumeAndSetPassword(input: {
    tokenId: string;
    userId: string;
    newPasswordHash: string;
  }): Promise<boolean> {
    return db.transaction(async (tx) => {
      // Conditional on still being unconsumed: two clicks on the same link
      // race here and exactly one wins.
      const consumed = rowsOf(
        await tx.execute(sql`
          update password_reset_tokens
          set consumed_at = now()
          where id = ${input.tokenId}::uuid and consumed_at is null
          returning id
        `),
      );
      if (consumed.length === 0) return false;

      await tx.execute(sql`
        update users
        set password_hash = ${input.newPasswordHash},
            -- Every token issued before this instant dies with the reset. If
            -- the reset was triggered BY an attacker holding a session, this
            -- is what removes them.
            sessions_invalidated_after = now()
        where id = ${input.userId}::uuid
      `);

      // Any other outstanding link for this user is now void.
      await tx.execute(sql`
        update password_reset_tokens
        set consumed_at = now()
        where user_id = ${input.userId}::uuid and consumed_at is null
      `);

      return true;
    });
  }

  async countRecentTokens(userId: string, since: Date): Promise<number> {
    const rows = rowsOf(
      await db.execute(sql`
        select count(*)::int as n from password_reset_tokens
        where user_id = ${userId}::uuid and created_at >= ${since.toISOString()}::timestamptz
      `),
    );
    return Number(rows[0]?.n ?? 0);
  }

  async invalidateOutstanding(userId: string): Promise<number> {
    const rows = rowsOf(
      await db.execute(sql`
        update password_reset_tokens set consumed_at = now()
        where user_id = ${userId}::uuid and consumed_at is null
        returning id
      `),
    );
    return rows.length;
  }
}
