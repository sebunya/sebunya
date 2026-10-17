import { sql } from 'drizzle-orm';
import { db } from '../client';
import { IAdminUserReadRepository, AdminUserReadModel, AccountLookupModel } from '../../../application/ports/IAdminUserReadRepository';

const rowsOf = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));

/** A staff account holds a role or is the subject of a pending grant request (see the port). */
const IS_STAFF = sql`(exists (select 1 from user_roles ur where ur.user_id = u.id)
  or exists (select 1 from role_grant_requests g where g.user_id = u.id and g.status = 'PENDING'))`;

const toModel = (r: any): AdminUserReadModel => ({
  id: String(r.id), email: String(r.email), phone: r.phone ?? null, isActive: Boolean(r.is_active),
  roleNames: Array.isArray(r.role_names) ? r.role_names.filter(Boolean).map(String) : [], createdAt: new Date(r.created_at),
});

export class DrizzleAdminUserReadRepository implements IAdminUserReadRepository {
  async findStaff(): Promise<AdminUserReadModel[]> {
    return rowsOf(await db.execute(sql`
      select u.id, u.email, u.phone, u.is_active, u.created_at,
        coalesce((select array_agg(r.name order by r.name) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id), '{}') as role_names
      from users u where ${IS_STAFF}
      order by u.is_active desc, u.created_at
      limit 1000`)).map(toModel);
  }

  async countShopperAccounts(): Promise<number> {
    const [r] = rowsOf(await db.execute(sql`select count(*)::int as n from users u where not ${IS_STAFF}`));
    return Number(r?.n ?? 0);
  }

  async findAccountByEmail(email: string): Promise<AccountLookupModel | null> {
    const e = email.trim().toLowerCase();
    if (!e || e.length > 320) return null;
    return this.account(sql`lower(u.email) = ${e}`);
  }

  async findAccountById(id: string): Promise<AccountLookupModel | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return this.account(sql`u.id = ${id}::uuid`);
  }

  private async account(where: ReturnType<typeof sql>): Promise<AccountLookupModel | null> {
    const [r] = rowsOf(await db.execute(sql`
      select u.id, u.email, u.phone, u.is_active, u.created_at,
        coalesce((select array_agg(r.name order by r.name) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id), '{}') as role_names,
        (select count(*)::int from orders o where o.user_id = u.id) as order_count,
        exists (select 1 from role_grant_requests g where g.user_id = u.id and g.status = 'PENDING') as pending
      from users u where ${where} limit 1`));
    return r ? { ...toModel(r), orderCount: Number(r.order_count ?? 0), hasPendingGrant: Boolean(r.pending) } : null;
  }
}
