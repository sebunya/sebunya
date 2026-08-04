import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { permissions, rolePermissions, roles, userRoles, users } from '../db/schema/identity';
import { auditLogs } from '../db/schema/system';
import { logger } from '../logging/logger';
import { env } from '../../config/env';
import {
  GOVERNANCE_ROLES,
  LEGACY_FULL_ACCESS_ROLE,
  PLATFORM_ADMINISTRATOR_ROLE,
  registryPermissionRows,
} from './permissionRegistryContract';

/**
 * Converges the database on the code permission registry at every boot.
 *
 * Non-destructive by design: rows are only ADDED (missing permissions, missing role
 * grants, the missing admin assignment). Nothing is revoked here — revocation is a
 * governed human action through the roles surfaces, and a sync that deletes is a sync
 * that can lock every operator out because of a refactor. Drift beyond the registry is
 * REPORTED, not repaired.
 *
 * Concurrency: two API replicas boot together in production and neither the
 * permissions table nor user_roles has a uniqueness constraint, so the whole sync runs
 * inside one transaction holding a pg advisory xact lock — the second replica waits,
 * then finds nothing left to insert.
 */

const SYNC_LOCK_KEY = 74123001;

export interface PermissionSyncSummary {
  permissionsInserted: number;
  rolesCreated: number;
  adminGrantsAdded: number;
  legacyGrantsAdded: number;
  legalReviewerGrantsAdded: number;
  bootstrapAdminAssigned: boolean;
  permissionsBeyondRegistry: number;
}

export async function syncPermissionRegistry(): Promise<PermissionSyncSummary> {
  const registry = registryPermissionRows();

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SYNC_LOCK_KEY})`);

    const existing = await tx.select({ id: permissions.id, action: permissions.action, resource: permissions.resource }).from(permissions);
    const existingByCode = new Map(existing.map((p) => [`${p.action}.${p.resource}`, p.id]));

    const missingPerms = registry.filter((r) => !existingByCode.has(r.code));
    if (missingPerms.length > 0) {
      const inserted = await tx
        .insert(permissions)
        .values(missingPerms.map((r) => ({ action: r.action, resource: r.resource })))
        .returning({ id: permissions.id, action: permissions.action, resource: permissions.resource });
      for (const p of inserted) existingByCode.set(`${p.action}.${p.resource}`, p.id);
    }

    const roleRows = await tx
      .insert(roles)
      .values(GOVERNANCE_ROLES.map((name) => ({ name })))
      .onConflictDoNothing({ target: roles.name })
      .returning({ id: roles.id, name: roles.name });
    const rolesCreated = roleRows.length;

    const findRoleId = async (name: string): Promise<string | null> => {
      const [row] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.name, name)).limit(1);
      return row?.id ?? null;
    };

    const adminRoleId = await findRoleId(PLATFORM_ADMINISTRATOR_ROLE);
    if (!adminRoleId) throw new Error('PLATFORM_ADMINISTRATOR role missing after ensure — sync aborted');

    const registryPermissionIds = registry.map((r) => existingByCode.get(r.code)!).filter(Boolean);

    const grantAll = async (roleId: string): Promise<number> => {
      const granted = await tx
        .insert(rolePermissions)
        .values(registryPermissionIds.map((permissionId) => ({ roleId, permissionId })))
        .onConflictDoNothing()
        .returning({ permissionId: rolePermissions.permissionId });
      return granted.length;
    };

    const adminGrantsAdded = await grantAll(adminRoleId);


    // §6/§7 alignment: LEGAL_REVIEWER's function is defined by its name — reviewing
    // and approving legal wording. Baseline grants are add-only, like everything in
    // this sync; other vocabulary roles stay empty pending business decisions.
    const legalReviewerId = await findRoleId('LEGAL_REVIEWER');
    let legalReviewerGrantsAdded = 0;
    if (legalReviewerId) {
      const baselineCodes = ['legal.read', 'legal.approve'];
      const baselineIds = baselineCodes.map((code) => existingByCode.get(code)).filter((v): v is string => Boolean(v));
      if (baselineIds.length > 0) {
        const granted = await tx
          .insert(rolePermissions)
          .values(baselineIds.map((permissionId) => ({ roleId: legalReviewerId, permissionId })))
          .onConflictDoNothing()
          .returning({ permissionId: rolePermissions.permissionId });
        legalReviewerGrantsAdded = granted.length;
      }
    }

    // Top up (never trim) the legacy full-access role the bootstrap admin holds today.
    const legacyRoleId = await findRoleId(LEGACY_FULL_ACCESS_ROLE);
    const legacyGrantsAdded = legacyRoleId ? await grantAll(legacyRoleId) : 0;

    // Assign PLATFORM_ADMINISTRATOR to the bootstrap administrator, idempotently.
    // user_roles has no uniqueness constraint, so existence is checked under the lock.
    let bootstrapAdminAssigned = false;
    const adminEmail = env.bootstrapAdminEmail;
    if (adminEmail) {
      const [adminUser] = await tx.select({ id: users.id }).from(users).where(eq(users.email, adminEmail)).limit(1);
      if (adminUser) {
        const [already] = await tx
          .select({ userId: userRoles.userId })
          .from(userRoles)
          .where(sql`${userRoles.userId} = ${adminUser.id} and ${userRoles.roleId} = ${adminRoleId}`)
          .limit(1);
        if (!already) {
          await tx.insert(userRoles).values({ userId: adminUser.id, roleId: adminRoleId });
          bootstrapAdminAssigned = true;
        }
      }
    }

    const summary: PermissionSyncSummary = {
      permissionsInserted: missingPerms.length,
      rolesCreated,
      adminGrantsAdded,
      legacyGrantsAdded,
      legalReviewerGrantsAdded,
      bootstrapAdminAssigned,
      permissionsBeyondRegistry: existing.filter((p) => !registry.some((r) => r.code === `${p.action}.${p.resource}`)).length,
    };

    const changed =
      summary.permissionsInserted > 0 ||
      summary.rolesCreated > 0 ||
      summary.adminGrantsAdded > 0 ||
      summary.legacyGrantsAdded > 0 ||
      summary.legalReviewerGrantsAdded > 0 ||
      summary.bootstrapAdminAssigned;

    if (changed) {
      // System actor: actorId stays null; the entity anchor is the administrator role
      // the sync converged. The summary is small, structured and secret-free.
      await tx.insert(auditLogs).values({
        actorId: null,
        action: 'permission_registry.sync',
        entity: 'role',
        entityId: adminRoleId,
        previousState: null,
        newState: summary,
      });
    }

    return summary;
  });
}

/** Boot wrapper: bounded retries, loud on failure, never crashes the API. */
export async function runPermissionRegistrySyncAtBoot(): Promise<void> {
  const delays = [0, 2000, 5000];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) await new Promise((r) => setTimeout(r, delays[attempt]));
    try {
      const summary = await syncPermissionRegistry();
      logger.info({ ...summary }, '[PermissionRegistrySync] converged');
      if (summary.permissionsBeyondRegistry > 0) {
        logger.warn(
          { beyondRegistry: summary.permissionsBeyondRegistry },
          '[PermissionRegistrySync] permission rows exist beyond the code registry — review, do not hand-delete',
        );
      }
      return;
    } catch (err) {
      const final = attempt === delays.length - 1;
      logger[final ? 'error' : 'warn'](
        { err, attempt: attempt + 1 },
        final
          ? '[PermissionRegistrySync] FAILED after retries — API continues on existing grants; investigate before any role change'
          : '[PermissionRegistrySync] attempt failed, retrying',
      );
    }
  }
}
