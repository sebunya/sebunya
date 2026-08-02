import { eq } from 'drizzle-orm';
import { db } from '../client';
import { users } from '../schema/identity';
import { IUserRepository, PersistedUser } from '../../../application/ports/IUserRepository';

function rowToUser(row: typeof users.$inferSelect): PersistedUser {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone ?? null,
    passwordHash: row.passwordHash,
    isActive: row.isActive,
    createdAt: row.createdAt,
    sessionsInvalidatedAfter: row.sessionsInvalidatedAfter ?? null,
  };
}

export class DrizzleUserRepository implements IUserRepository {
  async findByEmail(email: string): Promise<PersistedUser | null> {
    const normalised = email.trim().toLowerCase();
    if (!normalised) return null;
    const row = await db.query.users.findFirst({ where: eq(users.email, normalised) });
    return row ? rowToUser(row) : null;
  }

  async findById(id: string): Promise<PersistedUser | null> {
    if (!id) return null;
    const row = await db.query.users.findFirst({ where: eq(users.id, id) });
    return row ? rowToUser(row) : null;
  }

  async create(input: { email: string; phone: string | null; passwordHash: string }): Promise<PersistedUser> {
    const normalised = input.email.trim().toLowerCase();
    try {
      const [row] = await db
        .insert(users)
        .values({
          email: normalised,
          phone: input.phone,
          passwordHash: input.passwordHash,
        })
        .returning();
      return rowToUser(row);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/duplicate key|unique constraint|UNIQUE/i.test(message)) {
        throw new Error('USER_EMAIL_TAKEN');
      }
      throw err;
    }
  }
}
