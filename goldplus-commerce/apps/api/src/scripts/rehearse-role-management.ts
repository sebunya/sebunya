import '../config/env';
import { sql } from 'drizzle-orm';
import { db, endDbConnection } from '../infrastructure/db/client';
import { syncPermissionRegistry } from '../infrastructure/security/PermissionRegistrySync';
import { DrizzleAdminRoleWriteRepository } from '../infrastructure/db/repositories/DrizzleAdminRoleWriteRepository';
import { DrizzleAdminRoleReadRepository } from '../infrastructure/db/repositories/DrizzleAdminRoleReadRepository';
import { RoleManagementUseCase } from '../application/use-cases/admin/RoleManagementUseCase';
import { PERMISSIONS } from '@goldplus/shared';

/**
 * Rehearse role management against a database clone (2026-09-12).
 *
 *   DATABASE_URL=<ephemeral clone> npx tsx src/scripts/rehearse-role-management.ts
 *
 * Refuses to run unless the URL names a rehearsal database. Runs the boot
 * sync (baselines into empty roles), prints every role's grant count, then
 * drives the write repository through create → replace → guard → delete,
 * exactly the calls the Back Office makes, and prints each outcome. Nothing
 * here is idempotency-sensitive: the clone is thrown away afterwards.
 */
async function main(): Promise<void> {
  const url = String(process.env.DATABASE_URL ?? '');
  if (!/rehearse/.test(url)) throw new Error('Refusing: DATABASE_URL does not name a rehearsal clone.');

  const before = await syncPermissionRegistry();
  console.log('SYNC', JSON.stringify(before));
  const again = await syncPermissionRegistry();
  console.log('SYNC_AGAIN (must add nothing)', JSON.stringify({ baselineGrantsAdded: again.baselineGrantsAdded, adminGrantsAdded: again.adminGrantsAdded }));

  const read = new DrizzleAdminRoleReadRepository();
  for (const r of (await read.findAll()).sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`ROLE ${r.name.padEnd(24)} perms=${String(r.permissionCodes.length).padStart(3)} users=${r.userCount}`);
  }

  const repo = new DrizzleAdminRoleWriteRepository();
  const uc = new RoleManagementUseCase(repo);
  const actorId = '00000000-0000-0000-0000-000000000000';

  const created = await uc.createRole({ name: 'REHEARSAL_ROLE', permissionCodes: [PERMISSIONS.ORDERS_READ, PERMISSIONS.ORDERS_MANAGE], actorId });
  console.log('CREATE', JSON.stringify(created));
  if (!created.ok) throw new Error('create failed');
  const id = created.value.id;

  const replaced = await uc.replacePermissions({ roleId: id, permissionCodes: [PERMISSIONS.ORDERS_READ, PERMISSIONS.ANALYTICS_READ, 'analytics.alerts.manage'], actorId });
  console.log('REPLACE', JSON.stringify(replaced.ok ? { previous: replaced.value.previousCodes, next: replaced.value.nextCodes } : replaced));
  const afterReplace = await repo.findRoleById(id);
  console.log('READ_BACK', JSON.stringify(afterReplace?.permissionCodes));

  const unknown = await uc.replacePermissions({ roleId: id, permissionCodes: ['read.products'], actorId });
  console.log('LEGACY_CODE_REFUSED', JSON.stringify(unknown));

  const sec = await repo.findRoleByName('SECURITY_ADMIN');
  if (sec) {
    const others = await repo.countActiveUsersWithPermissionOutsideRole(PERMISSIONS.AUTH_MANAGE, sec.id);
    console.log('ACTIVE_HOLDERS_OF_auth.manage_OUTSIDE_SECURITY_ADMIN', others);
  }
  const pa = await repo.findRoleByName('PLATFORM_ADMINISTRATOR');
  if (pa) console.log('SYSTEM_ROLE_EDIT', JSON.stringify(await uc.replacePermissions({ roleId: pa.id, permissionCodes: [], actorId })));

  const [{ n }] = (await db.execute(sql`select count(*)::int as n from role_permissions where role_id = ${id}`)) as unknown as { n: number }[];
  console.log('GRANT_ROWS_BEFORE_DELETE', n);
  const deleted = await uc.deleteRole({ roleId: id, actorId });
  console.log('DELETE', JSON.stringify(deleted.ok ? { name: deleted.value.role.name } : deleted));
  const [{ n: left }] = (await db.execute(sql`select count(*)::int as n from role_permissions where role_id = ${id}`)) as unknown as { n: number }[];
  console.log('GRANT_ROWS_AFTER_DELETE', left);
  console.log('REHEARSAL_OK');
}

main()
  .then(() => endDbConnection())
  .catch(async (e) => {
    console.error('REHEARSAL_FAILED', e);
    await endDbConnection();
    process.exit(1);
  });
