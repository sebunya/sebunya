import { and, eq } from 'drizzle-orm';
import { db } from '../client';
import { userIdentities } from '../schema/cms';
import { IUserIdentityRepository, PersistedUserIdentity } from '../../../application/ports/IUserIdentityRepository';

function rowToIdentity(row: typeof userIdentities.$inferSelect): PersistedUserIdentity {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    providerUserId: row.providerUserId,
    email: row.email ?? null,
    createdAt: row.createdAt,
  };
}

export class DrizzleUserIdentityRepository implements IUserIdentityRepository {
  async findByProvider(provider: string, providerUserId: string): Promise<PersistedUserIdentity | null> {
    const row = await db.query.userIdentities.findFirst({
      where: and(eq(userIdentities.provider, provider), eq(userIdentities.providerUserId, providerUserId)),
    });
    return row ? rowToIdentity(row) : null;
  }

  async link(input: {
    userId: string;
    provider: string;
    providerUserId: string;
    email: string | null;
  }): Promise<PersistedUserIdentity> {
    const [row] = await db
      .insert(userIdentities)
      .values({
        userId: input.userId,
        provider: input.provider,
        providerUserId: input.providerUserId,
        email: input.email,
      })
      .returning();
    return rowToIdentity(row);
  }

  async listForUser(userId: string): Promise<PersistedUserIdentity[]> {
    const rows = await db.query.userIdentities.findMany({ where: eq(userIdentities.userId, userId) });
    return rows.map(rowToIdentity);
  }

  async unlink(userId: string, provider: string): Promise<boolean> {
    const deleted = await db
      .delete(userIdentities)
      .where(and(eq(userIdentities.userId, userId), eq(userIdentities.provider, provider)))
      .returning({ id: userIdentities.id });
    return deleted.length > 0;
  }
}
