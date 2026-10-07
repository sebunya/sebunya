import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db, endDbConnection } from '../../apps/api/src/infrastructure/db/client';
import { Hs256TokenSigner } from '../../apps/api/src/infrastructure/security/Hs256TokenSigner';
import { users, roles, permissions, rolePermissions, userRoles } from '../../apps/api/src/infrastructure/db/schema/identity';
import { automationDefinitions, automationEvents } from '../../apps/api/src/infrastructure/db/schema/automation';

const actorId = randomUUID();
const roleId = randomUUID();
const permissionIds = [randomUUID(), randomUUID()];
let definitionId = '';
let token = '';

test.describe.configure({ mode: 'serial' });

// Unique per run: the desktop and mobile projects run at once, and two
// fixtures with one name made the visibility check ambiguous.
const FIXTURE_NAME = `A4 browser persistence proof ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test.beforeAll(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  // Database access here goes through the shared client, which honours DATABASE_URL and
  // otherwise falls back to localhost:5432. Without this guard an unset variable surfaces
  // as a bare ECONNREFUSED against a port the suite never intended to use.
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL_REQUIRED: this browser proof writes real fixtures through the API database. ' +
        'Export DATABASE_URL for the test database (any host/port) before running it.',
    );
  }
  if ((process.env.JWT_SECRET ?? '').length < 32) {
    throw new Error(
      'JWT_SECRET_REQUIRED: this browser proof signs a real admin session token. ' +
        'Export a JWT_SECRET of at least 32 characters, matching the API under test.',
    );
  }
  await db.insert(users).values({ id: actorId, email: `a4-browser-${actorId}@fixture.local`, passwordHash: 'not-used', isActive: true });
  await db.insert(roles).values({ id: roleId, name: `a4-browser-${roleId.slice(0, 8)}` });
  await db.insert(permissions).values([
    { id: permissionIds[0], action: 'automation', resource: 'read' },
    { id: permissionIds[1], action: 'automation', resource: 'create' },
  ]);
  await db.insert(rolePermissions).values(permissionIds.map((permissionId) => ({ roleId, permissionId })));
  await db.insert(userRoles).values({ userId: actorId, roleId });
  token = await new Hs256TokenSigner().sign({ subject: actorId, email: `a4-browser-${actorId}@fixture.local`, ttlSeconds: 600 });
  const response = await fetch('http://127.0.0.1:3000/admin/automation/definitions', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FIXTURE_NAME, description: 'Real scratch persistence; removed after browser proof.' }),
  });
  const body = await response.json() as any;
  if (!response.ok || !body.success) throw new Error(`A4 browser fixture API failed: ${response.status}`);
  definitionId = body.data.id;
});

test.afterAll(async () => {
  if (definitionId) {
    // audit_logs is append-only (0055): its rows stay, as they would in production.
    await db.delete(automationEvents).where(eq(automationEvents.definitionId, definitionId));
    await db.delete(automationDefinitions).where(eq(automationDefinitions.id, definitionId));
  }
  await db.delete(userRoles).where(eq(userRoles.userId, actorId));
  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  await db.delete(permissions).where(inArray(permissions.id, permissionIds));
  await db.delete(roles).where(eq(roles.id, roleId));
  await db.delete(users).where(eq(users.id, actorId));
  await endDbConnection();
});

test('renders the protected control room from real API persistence', async ({ page, context }) => {
  await context.addCookies([{ name: 'goldplus_session', value: token, url: 'http://127.0.0.1:4321', httpOnly: true, sameSite: 'Lax' }]);
  const response = await page.goto('/admin/automation');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Automation control room' })).toBeVisible();
  await expect(page.getByText(FIXTURE_NAME)).toBeVisible();
  await expect(page.getByText('Empty — no persisted executions exist.')).toBeVisible();
  await expect(page.getByText(/This is persisted evidence, not provider mock status/)).toBeVisible();
  await page.getByText('Truthful state glossary').click();
  await expect(page.getByText('OUTCOME_UNKNOWN', { exact: true })).toBeVisible();
});
