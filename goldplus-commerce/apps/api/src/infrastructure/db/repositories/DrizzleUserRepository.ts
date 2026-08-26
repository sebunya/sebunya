import { eq, inArray } from 'drizzle-orm';
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
    phoneVerifiedAt: (row as { phoneVerifiedAt?: Date | null }).phoneVerifiedAt ?? null,
  };
}

export class DrizzleUserRepository implements IUserRepository {
  async findByPhone(phoneE164: string): Promise<PersistedUser | null> {
    const e164 = (phoneE164 ?? '').trim();
    if (!/^\+256\d{9}$/.test(e164)) return null;
    // Registration stores the typed shape; verification stores E.164. Both are
    // the same number, so both are looked up. The column is unique, so at most
    // one row per shape; two rows means two accounts claim one number, and
    // neither may be chosen for a reset.
    const local = e164.replace('+256', '0');
    const rows = await db.query.users.findMany({ where: inArray(users.phone, [e164, local]), limit: 2 });
    if (rows.length !== 1) return null;
    return rowToUser(rows[0]);
  }

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
