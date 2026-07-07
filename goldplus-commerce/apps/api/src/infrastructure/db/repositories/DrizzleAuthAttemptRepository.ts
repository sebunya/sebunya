import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../client';
import { authAttempts } from '../schema/security';
import { IAuthAttemptRepository, AuthOutcome } from '../../../application/ports/IAuthAttemptRepository';

export class DrizzleAuthAttemptRepository implements IAuthAttemptRepository {
  async record(input: {
    email: string | null;
    userId: string | null;
    ipAddress: string | null;
    outcome: AuthOutcome;
    riskScore: number;
  }): Promise<void> {
    await db.insert(authAttempts).values({
      email: input.email,
      userId: input.userId,
      ipAddress: input.ipAddress,
      outcome: input.outcome,
      riskScore: input.riskScore,
    });
  }

  async countRecentFailures(opts: { email?: string | null; ipAddress?: string | null; since: Date }): Promise<number> {
    const conditions = [
      gte(authAttempts.createdAt, opts.since),
      sql`${authAttempts.outcome} IN ('BAD_CREDENTIALS','TWO_FACTOR_FAILED','LOCKED')`,
    ];
    if (opts.email) conditions.push(eq(authAttempts.email, opts.email));
    if (opts.ipAddress) conditions.push(eq(authAttempts.ipAddress, opts.ipAddress));
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(authAttempts)
      .where(and(...conditions));
    return Number(row?.count ?? 0);
  }

  async hasPriorSuccess(email: string): Promise<boolean> {
    const row = await db.query.authAttempts.findFirst({
      where: and(eq(authAttempts.email, email), eq(authAttempts.outcome, 'SUCCESS')),
    });
    return !!row;
  }
}
