import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '../client';
import { permissions, rolePermissions, roles, userRoles, users } from '../schema/identity';
import { splitPermissionCode } from '../../security/permissionRegistryContract';
import type { AdminRoleDetail, IAdminRoleWriteRepository } from '../../../application/ports/IAdminRoleWriteRepository';

/**
 * Role management writes. Codes → rows use the registry split (first dot),
 * the same translation the boot sync uses, so a code granted here is exactly
 * the code the auth middleware checks. Legacy `read.products`-style rows are
 * never matched and never granted.
 */
export class DrizzleAdminRoleWriteRepository implements IAdminRoleWriteRepository {
  async findRoleByName(name: string): Promise<{ id: string; name: string } | null> {
    const [row] = await db.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.name, name)).limit(1);
    return row ?? null;
  }

  async findRoleById(id: string): Promise<AdminRoleDetail | null> {
    const [row] = await db.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.id, id)).limit(1);
    if (!row) return null;
    const grants = await db
      .select({ action: permissions.action, resource: permissions.resource })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, id));
    const [count] = await db
      .select({ n: sql<number>`count(distinct ${userRoles.userId})::int` })
      .from(userRoles)
      .where(eq(userRoles.roleId, id));
    const codes = Array.from(new Set(grants.map((g) => `${g.action}.${g.resource}`))).sort();
    return { id: row.id, name: row.name, permissionCodes: codes, userCount: Number(count?.n ?? 0) };
  }

  async createRole(name: string, permissionCodes: string[]): Promise<{ id: string }> {
    return db.transaction(async (tx) => {
      const [created] = await tx.insert(roles).values({ name }).returning({ id: roles.id });
      const ids = await this.permissionIdsFor(permissionCodes);
      if (ids.length > 0) {
        await tx.insert(rolePermissions).values(ids.map((permissionId) => ({ roleId: created.id, permissionId }))).onConflictDoNothing();
      }
      return { id: created.id };
    });
  }

  async replacePermissions(roleId: string, permissionCodes: string[]): Promise<void> {
    const ids = await this.permissionIdsFor(permissionCodes);
    await db.transaction(async (tx) => {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      if (ids.length > 0) {
        await tx.insert(rolePermissions).values(ids.map((permissionId) => ({ roleId, permissionId }))).onConflictDoNothing();
      }
    });
  }

  async deleteRole(roleId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      await tx.delete(userRoles).where(eq(userRoles.roleId, roleId));
      await tx.delete(roles).where(eq(roles.id, roleId));
    });
  }

  async countActiveUsersWithPermissionOutsideRole(code: string, roleId: string): Promise<number> {
    const { action, resource } = splitPermissionCode(code);
    const [row] = await db
      .select({ n: sql<number>`count(distinct ${userRoles.userId})::int` })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(
        and(
          eq(users.isActive, true),
          ne(userRoles.roleId, roleId),
          eq(permissions.action, action),
          eq(permissions.resource, resource),
        ),
      );
    return Number(row?.n ?? 0);
  }

  /** One permission id per code; a code with no row (registry not yet synced) is skipped, never invented. */
  private async permissionIdsFor(codes: string[]): Promise<string[]> {
    const unique = Array.from(new Set(codes));
    if (unique.length === 0) return [];
    const pairs = unique.map(splitPermissionCode);
    const rows = await db
      .select({ id: permissions.id, action: permissions.action, resource: permissions.resource })
      .from(permissions)
      .where(inArray(permissions.action, Array.from(new Set(pairs.map((p) => p.action)))));
    const byCode = new Map<string, string>();
    for (const r of rows) {
      const code = `${r.action}.${r.resource}`;
      if (!byCode.has(code)) byCode.set(code, r.id);
    }
    return unique.map((c) => byCode.get(c)).filter((v): v is string => Boolean(v));
  }
}
