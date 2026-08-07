import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { ISocialIdentityRepository, LinkedIdentity } from '../../../application/ports/ISocialIdentityRepository';
import type { SocialProvider } from '../../../domain/identity/SocialProvider';

const rowsOf = (result: any): any[] => (Array.isArray(result) ? result : result?.rows ?? []);

const toIdentity = (row: any): LinkedIdentity => ({
  id: String(row.id),
  userId: String(row.user_id),
  provider: String(row.provider) as SocialProvider,
  subject: String(row.subject),
  email: row.email ? String(row.email) : null,
  emailVerified: Boolean(row.email_verified),
});

export class DrizzleSocialIdentityRepository implements ISocialIdentityRepository {
  async findByProviderSubject(provider: SocialProvider, subject: string): Promise<LinkedIdentity | null> {
    const rows = rowsOf(
      await db.execute(sql`
        select * from user_identities where provider = ${provider} and subject = ${subject} limit 1
      `),
    );
    return rows.length > 0 ? toIdentity(rows[0]) : null;
  }

  async listForUser(userId: string): Promise<LinkedIdentity[]> {
    const rows = rowsOf(
      await db.execute(sql`select * from user_identities where user_id = ${userId}::uuid order by linked_at`),
    );
    return rows.map(toIdentity);
  }

  async link(input: {
    userId: string;
    provider: SocialProvider;
    subject: string;
    email: string | null;
    emailVerified: boolean;
  }): Promise<LinkedIdentity> {
    const rows = rowsOf(
      await db.execute(sql`
        insert into user_identities (user_id, provider, subject, email, email_verified)
        values (${input.userId}::uuid, ${input.provider}, ${input.subject}, ${input.email}, ${input.emailVerified})
        on conflict (provider, subject) do update
          set email = excluded.email, email_verified = excluded.email_verified
        returning *
      `),
    );
    return toIdentity(rows[0]);
  }

  async createUserWithIdentity(input: {
    email: string;
    provider: SocialProvider;
    subject: string;
    emailVerified: boolean;
  }): Promise<{ userId: string; identity: LinkedIdentity }> {
    return db.transaction(async (tx) => {
      // password_hash stays NULL: this customer chose a provider, not a
      // password, and inventing one would be a credential nobody picked.
      const userRows = rowsOf(
        await tx.execute(sql`
          insert into users (email, password_hash) values (${input.email}, ${null}) returning id
        `),
      );
      const userId = String(userRows[0].id);
      const identityRows = rowsOf(
        await tx.execute(sql`
          insert into user_identities (user_id, provider, subject, email, email_verified)
          values (${userId}::uuid, ${input.provider}, ${input.subject}, ${input.email}, ${input.emailVerified})
          returning *
        `),
      );
      return { userId, identity: toIdentity(identityRows[0]) };
    });
  }

  async markLogin(identityId: string): Promise<void> {
    await db.execute(sql`update user_identities set last_login_at = now() where id = ${identityId}::uuid`);
  }

  async unlink(userId: string, provider: SocialProvider): Promise<{ ok: boolean; reason?: string }> {
    return db.transaction(async (tx) => {
      const state = rowsOf(
        await tx.execute(sql`
          select
            (select password_hash is not null from users where id = ${userId}::uuid) as has_password,
            (select count(*)::int from user_identities where user_id = ${userId}::uuid) as identities
        `),
      )[0];

      const hasPassword = Boolean(state?.has_password);
      const identities = Number(state?.identities ?? 0);

      // Removing the last door locks the customer out of their own account.
      if (!hasPassword && identities <= 1) {
        return {
          ok: false,
          reason: 'This is the only way to sign in to this account. Set a password first, or link another provider.',
        };
      }

      await tx.execute(sql`
        delete from user_identities where user_id = ${userId}::uuid and provider = ${provider}
      `);
      return { ok: true };
    });
  }
}
