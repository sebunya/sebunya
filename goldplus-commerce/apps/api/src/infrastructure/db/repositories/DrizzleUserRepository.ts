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

    // EVERY shape the same number can already be stored in.
    //
    // Registration accepts /^(\+?256|0)?[17]\d{8}$/ and stores the typed shape
    // with only a leading '+' removed, so the column really holds four forms of
    // one number: 256771234567, 0771234567, 771234567 and (from verification)
    // +256771234567. This lookup searched two of them, and one of those two —
    // the '+' form — is the one registration can never produce.
    //
    // The effect was that a customer who typed their number as +256..., 256...
    // or bare 9 digits could never reset their password by SMS: findByPhone
    // returned null, the use case answered with the generic acknowledgement, and
    // no message was ever sent. They were told nothing was wrong.
    //
    // The column is unique, so at most one row per shape; more than one row means
    // two accounts claim one number and neither may be chosen for a reset.
    const national = e164.slice(4);
    const candidates = [e164, `256${national}`, `0${national}`, national];
    const rows = await db.query.users.findMany({ where: inArray(users.phone, candidates), limit: 2 });
    if (rows.length !== 1) return null;
    return rowToUser(rows[0]);
  }

  async invalidateSessionsAfter(userId: string, at: Date): Promise<void> {
    if (!userId) return;
    await db.update(users).set({ sessionsInvalidatedAfter: at }).where(eq(users.id, userId));
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
