/**
 * Slice 14E acceptance-only bootstrap (local/staging): creates a throwaway
 * owner (all permissions) and a plain customer. Refuses to run when
 * NODE_ENV=production. Never part of any production sequence.
 */
import '../config/env';
import { db } from '../infrastructure/db/client';
import { sql } from 'drizzle-orm';
import { ScryptPasswordHasher } from '../infrastructure/security/ScryptPasswordHasher';
import { PERMISSIONS } from '@goldplus/shared';

const run = async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to run in production.');
  const hasher = new ScryptPasswordHasher();
  const ownerHash = await hasher.hash(process.env.ACCEPTANCE_OWNER_PASSWORD || 'local-acceptance-owner-pass-1');
  const customerHash = await hasher.hash(process.env.ACCEPTANCE_CUSTOMER_PASSWORD || 'local-acceptance-customer-pass-1');

  await db.execute(sql`insert into users (id, email, password_hash, is_active)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','acceptance-owner@fixture.local',${ownerHash},true)
    on conflict (id) do update set password_hash=${ownerHash}`);
  await db.execute(sql`insert into users (id, email, password_hash, is_active)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-000000000002','acceptance-customer@fixture.local',${customerHash},true)
    on conflict (id) do update set password_hash=${customerHash}`);
  await db.execute(sql`insert into roles (id, name) values ('bbbbbbbb-bbbb-4bbb-8bbb-000000000001','acceptance_owner')
    on conflict (id) do nothing`);
  for (const key of Object.values(PERMISSIONS)) {
    // Permission strings compose as `${action}.${resource}` (DrizzleRoleRepository).
    const dot = key.indexOf('.');
    const action = key.slice(0, dot);
    const resource = key.slice(dot + 1);
    await db.execute(sql`insert into permissions (id, action, resource)
      select gen_random_uuid(), ${action}, ${resource}
      where not exists (select 1 from permissions where action=${action} and resource=${resource})`);
    await db.execute(sql`insert into role_permissions (role_id, permission_id)
      select 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', p.id from permissions p
      where p.action=${action} and p.resource=${resource}
      on conflict do nothing`);
  }
  await db.execute(sql`insert into user_roles (user_id, role_id)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-000000000001')
    on conflict do nothing`);
  console.log('ACCEPTANCE_BOOTSTRAP_OK');
  process.exit(0);
};
run().catch((e) => { console.error(e); process.exit(1); });
