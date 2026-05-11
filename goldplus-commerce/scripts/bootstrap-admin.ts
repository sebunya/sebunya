import { Registry } from '../apps/api/src/infrastructure/Registry';
import { db } from '../apps/api/src/infrastructure/db/client';
import { roles, permissions, userRoles, rolePermissions } from '../apps/api/src/infrastructure/db/schema/identity';
import { PERMISSIONS } from '@goldplus/shared';
import { eq, and } from 'drizzle-orm';

const OWNER_ROLE_NAME = 'Owner';

async function ensureOwnerRole(): Promise<string> {
  const existing = await db.query.roles.findFirst({ where: eq(roles.name, OWNER_ROLE_NAME) });
  if (existing) return existing.id;
  const [created] = await db.insert(roles).values({ name: OWNER_ROLE_NAME }).returning();
  return created.id;
}

async function ensurePermission(code: string): Promise<string> {
  const [action, resource] = code.split('.');
  if (!action || !resource) throw new Error(`Bad permission code: ${code}`);

  const existing = await db.query.permissions.findFirst({
    where: and(eq(permissions.action, action), eq(permissions.resource, resource)),
  });
  if (existing) return existing.id;
  const [created] = await db.insert(permissions).values({ action, resource }).returning();
  return created.id;
}

async function attachPermissionToRole(roleId: string, permissionId: string): Promise<void> {
  const existing = await db.query.rolePermissions.findFirst({
    where: and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permissionId)),
  });
  if (!existing) {
    await db.insert(rolePermissions).values({ roleId, permissionId });
  }
}

async function attachRoleToUser(userId: string, roleId: string): Promise<void> {
  const existing = await db.query.userRoles.findFirst({
    where: and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)),
  });
  if (!existing) {
    await db.insert(userRoles).values({ userId, roleId });
  }
}

async function main() {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '';
  const phone = (process.env.BOOTSTRAP_ADMIN_PHONE ?? '').trim() || null;

  if (!email || !password) {
    console.error('Not configured: set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD env vars to bootstrap an admin.');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('Owner review required: BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.');
    process.exit(1);
  }

  const registry = Registry.getInstance();
  const roleId = await ensureOwnerRole();
  console.log(`✓ Owner role: ${roleId}`);

  const allCodes = Object.values(PERMISSIONS);
  for (const code of allCodes) {
    const permissionId = await ensurePermission(code);
    await attachPermissionToRole(roleId, permissionId);
  }
  console.log(`✓ Owner role granted ${allCodes.length} permissions.`);

  let user = await registry.userRepo.findByEmail(email);
  if (!user) {
    const hash = await registry.passwordHasher.hash(password);
    user = await registry.userRepo.create({ email, phone, passwordHash: hash });
    console.log(`✓ Created admin user: ${user.id}`);
  } else {
    console.log(`✓ Admin user already exists: ${user.id}`);
  }

  await attachRoleToUser(user.id, roleId);
  console.log(`✓ Owner role attached to user.`);

  console.log('\nAdmin bootstrap complete. Sign in at /admin/login.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
