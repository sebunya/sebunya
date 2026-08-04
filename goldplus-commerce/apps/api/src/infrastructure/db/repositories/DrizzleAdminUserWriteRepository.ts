import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { roles, userRoles, users } from '../schema/identity';
import { roleGrantRequests } from '../schema/roleGrants';
import { IAdminUserWriteRepository } from '../../../application/use-cases/identity/AdminUserManagementUseCase';

/**
 * Persistence for governed user creation and role assignment (§6). Assignment is
 * where-not-exists idempotent (user_roles has no uniqueness constraint); a
 * duplicate PENDING grant request returns null so the use case can refuse it.
 */
export class DrizzleAdminUserWriteRepository implements IAdminUserWriteRepository {
  async findUserByEmail(email: string) {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    return row ?? null;
  }

  async createUser(input: { email: string; phone: string | null; passwordHash: string }) {
    const [row] = await db
      .insert(users)
      .values({ email: input.email, phone: input.phone, passwordHash: input.passwordHash })
      .returning({ id: users.id, email: users.email });
    return row;
  }

  private async roleId(roleName: string): Promise<string | null> {
    const [row] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, roleName)).limit(1);
    return row?.id ?? null;
  }

  async assignRole(userId: string, roleName: string): Promise<boolean> {
    const roleId = await this.roleId(roleName);
    if (!roleId) return false;
    const [existing] = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)))
      .limit(1);
    if (!existing) await db.insert(userRoles).values({ userId, roleId });
    return true;
  }

  async revokeRole(userId: string, roleName: string): Promise<boolean> {
    const roleId = await this.roleId(roleName);
    if (!roleId) return false;
    const deleted = await db
      .delete(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)))
      .returning({ userId: userRoles.userId });
    return deleted.length > 0;
  }

  async userHasRole(userId: string, roleName: string): Promise<boolean> {
    const roleId = await this.roleId(roleName);
    if (!roleId) return false;
    const [row] = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)))
      .limit(1);
    return Boolean(row);
  }

  async createGrantRequest(input: { userId: string; roleName: string; requestedBy: string; reason: string | null }) {
    const [pending] = await db
      .select({ id: roleGrantRequests.id })
      .from(roleGrantRequests)
      .where(
        and(
          eq(roleGrantRequests.userId, input.userId),
          eq(roleGrantRequests.roleName, input.roleName),
          eq(roleGrantRequests.status, 'PENDING'),
        ),
      )
      .limit(1);
    if (pending) return null;
    const [row] = await db.insert(roleGrantRequests).values(input).returning({ id: roleGrantRequests.id });
    return row;
  }

  async findGrantRequest(id: string) {
    const [row] = await db.select().from(roleGrantRequests).where(eq(roleGrantRequests.id, id)).limit(1);
    return row
      ? { id: row.id, userId: row.userId, roleName: row.roleName, status: row.status, requestedBy: row.requestedBy }
      : null;
  }

  async decideGrantRequest(id: string, fields: { status: 'APPROVED' | 'REJECTED'; decidedBy: string; reason: string | null }) {
    await db
      .update(roleGrantRequests)
      .set({ ...fields, decidedAt: new Date() })
      .where(eq(roleGrantRequests.id, id));
  }

  async listGrantRequests() {
    const rows = await db.select().from(roleGrantRequests).orderBy(desc(roleGrantRequests.requestedAt)).limit(50);
    return rows.map((r) => ({ id: r.id, userId: r.userId, roleName: r.roleName, status: r.status, requestedBy: r.requestedBy, requestedAt: r.requestedAt }));
  }
}
