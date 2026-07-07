import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../client';
import { otpChallenges } from '../schema/security';
import { IOtpChallengeRepository, PersistedOtpChallenge } from '../../../application/ports/IOtpChallengeRepository';
import { OtpChannel, OtpPurpose } from '../../../domain/security/OtpChallenge';

function rowToChallenge(row: typeof otpChallenges.$inferSelect): PersistedOtpChallenge {
  return {
    id: row.id,
    userId: row.userId ?? null,
    purpose: row.purpose as OtpPurpose,
    channel: row.channel as OtpChannel,
    destination: row.destination,
    codeHash: row.codeHash,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt ?? null,
    createdAt: row.createdAt,
  };
}

export class DrizzleOtpChallengeRepository implements IOtpChallengeRepository {
  async create(input: {
    userId: string | null;
    purpose: OtpPurpose;
    channel: OtpChannel;
    destination: string;
    codeHash: string;
    maxAttempts: number;
    expiresAt: Date;
  }): Promise<PersistedOtpChallenge> {
    const [row] = await db
      .insert(otpChallenges)
      .values({
        userId: input.userId,
        purpose: input.purpose,
        channel: input.channel,
        destination: input.destination,
        codeHash: input.codeHash,
        maxAttempts: input.maxAttempts,
        expiresAt: input.expiresAt,
      })
      .returning();
    return rowToChallenge(row);
  }

  async findById(id: string): Promise<PersistedOtpChallenge | null> {
    const row = await db.query.otpChallenges.findFirst({ where: eq(otpChallenges.id, id) });
    return row ? rowToChallenge(row) : null;
  }

  async incrementAttempts(id: string): Promise<void> {
    await db
      .update(otpChallenges)
      .set({ attempts: sql`${otpChallenges.attempts} + 1` })
      .where(eq(otpChallenges.id, id));
  }

  async markConsumed(id: string): Promise<void> {
    await db.update(otpChallenges).set({ consumedAt: new Date() }).where(eq(otpChallenges.id, id));
  }

  async countRecent(opts: { userId?: string | null; destination?: string; since: Date }): Promise<number> {
    const conditions = [gte(otpChallenges.createdAt, opts.since)];
    if (opts.userId) conditions.push(eq(otpChallenges.userId, opts.userId));
    if (opts.destination) conditions.push(eq(otpChallenges.destination, opts.destination));
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(otpChallenges)
      .where(and(...conditions));
    return Number(row?.count ?? 0);
  }
}
