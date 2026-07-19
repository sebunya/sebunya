import '../config/env';
import { randomUUID } from 'node:crypto';
import { db } from '../infrastructure/db/client';
import { users } from '../infrastructure/db/schema/identity';
import { orders } from '../infrastructure/db/schema/commerce';
import { customerProfiles, customerIdentityLinks, customerFeatureSnapshots, customerLifecycleSnapshots } from '../infrastructure/db/schema/customer_dna';
import {
  DrizzleCustomerProfileRepository, DrizzleCustomerIdentityRepository,
  DrizzleCustomerFeatureRepository, DrizzleCustomerLifecycleRepository,
} from '../infrastructure/db/repositories/DrizzleCustomerDnaRepositories';
import { DrizzleCustomerSignalReader } from '../infrastructure/db/repositories/DrizzleCustomerSignalReader';
import { DrizzleAuditRepository } from '../infrastructure/db/repositories/DrizzleAuditRepository';
import { ResolveCustomerIdentityUseCase, ProjectCustomerProfileUseCase } from '../application/use-cases/customer-dna/CustomerDnaUseCases';
import { eq, inArray } from 'drizzle-orm';

/**
 * Real-PostgreSQL proof (Customer DNA): identity uniqueness + idempotent linking +
 * conflict detection, idempotent projection, and cross-customer isolation.
 * Refuses to run in production.
 */
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');

  const userA = randomUUID();
  const userB = randomUUID();
  await db.insert(users).values([
    { id: userA, email: `a-${userA.slice(0, 8)}@ex.test`, phone: `070${userA.slice(0, 7)}`, passwordHash: 'x', isActive: true },
    { id: userB, email: `b-${userB.slice(0, 8)}@ex.test`, phone: `071${userB.slice(0, 7)}`, passwordHash: 'x', isActive: true },
  ]);
  const now = Date.now();
  const mkOrder = (uid: string, amount: number, daysAgo: number) => ({
    id: randomUUID(), userId: uid, orderNumber: `DNA-${randomUUID().slice(0, 6)}`, customerName: 'UAT', customerPhone: '0770000000',
    deliveryArea: 'X', deliveryAddress: 'Y', subtotalAmount: amount, totalAmount: amount, deliveryFee: 0,
    status: 'received', paymentStatus: 'paid', createdAt: new Date(now - daysAgo * 86_400_000), updatedAt: new Date(now - daysAgo * 86_400_000),
  });
  await db.insert(orders).values([mkOrder(userA, 500_000, 40), mkOrder(userA, 300_000, 5), mkOrder(userB, 900_000, 3)]);

  const profiles = new DrizzleCustomerProfileRepository();
  const identities = new DrizzleCustomerIdentityRepository();
  const featureRepo = new DrizzleCustomerFeatureRepository();
  const lifecycleRepo = new DrizzleCustomerLifecycleRepository();
  const audit = new DrizzleAuditRepository();
  const resolve = new ResolveCustomerIdentityUseCase(profiles, identities, audit);
  const project = new ProjectCustomerProfileUseCase(profiles, identities, featureRepo, lifecycleRepo, new DrizzleCustomerSignalReader(), audit);

  // Link A (authenticated) — CREATE, then IDEMPOTENT.
  const r1 = await resolve.execute({ signalType: 'AUTHENTICATED_CUSTOMER_ID', identifierKey: userA, accountUserId: userA, actorId: randomUUID() });
  const r2 = await resolve.execute({ signalType: 'AUTHENTICATED_CUSTOMER_ID', identifierKey: userA, accountUserId: userA, actorId: randomUUID() });
  const canonicalA = r1.ok ? r1.canonicalCustomerId : '';
  const linkCount = (await db.select().from(customerIdentityLinks).where(eq(customerIdentityLinks.identifierKey, userA))).length;

  // Weak signal rejected.
  const weak = await resolve.execute({ signalType: 'NAME_SIMILARITY', identifierKey: 'jane', actorId: randomUUID() });

  // Conflict: a shared verified email first binds to a fresh (no-account) canonical,
  // then re-asserted for account B → CONFLICT (never an auto-merge).
  const sharedEmailKey = `hash-${randomUUID().slice(0, 10)}`;
  const c1 = await resolve.execute({ signalType: 'VERIFIED_EMAIL', identifierKey: sharedEmailKey, actorId: randomUUID() });
  const c2 = await resolve.execute({ signalType: 'VERIFIED_EMAIL', identifierKey: sharedEmailKey, accountUserId: userB, actorId: randomUUID() });

  // Projection idempotency: first advances, second does not (same source version).
  const p1 = await project.execute({ canonicalCustomerId: canonicalA, actorId: randomUUID() });
  const p2 = await project.execute({ canonicalCustomerId: canonicalA, actorId: randomUUID() });

  // Cross-customer isolation: A's feature snapshot order_count reflects only A's 2 orders.
  const featA = await featureRepo.latest(canonicalA);
  const orderCountA = (featA?.features as any[])?.find((f) => f.key === 'order_count')?.value;

  const ok =
    r1.ok && r1.outcome === 'CREATE' &&
    r2.ok && r2.outcome === 'IDEMPOTENT' && linkCount === 1 &&
    weak.ok === false && (weak as any).code === 'UNAPPROVED_SIGNAL' &&
    c1.ok && c1.outcome === 'CREATE' &&
    c2.ok && c2.outcome === 'CONFLICT' &&
    p1.ok && (p1 as any).advanced === true &&
    p2.ok && (p2 as any).advanced === false &&
    orderCountA === 2;

  console.log(JSON.stringify({
    linkOutcome1: r1.ok && r1.outcome, linkOutcome2: r2.ok && r2.outcome, linkRows: linkCount,
    weakRejected: weak.ok === false && (weak as any).code,
    conflictOutcome: c2.ok && c2.outcome,
    projectAdvanced1: (p1 as any).advanced, projectAdvanced2: (p2 as any).advanced,
    isolatedOrderCountA: orderCountA,
    verdict: ok ? 'PASS' : 'FAIL',
  }));

  // Cleanup — every canonical this proof created (via a link OR an account profile).
  const myCanonicals = new Set<string>();
  const myLinks = await db.select().from(customerIdentityLinks).where(inArray(customerIdentityLinks.identifierKey, [userA, userB, sharedEmailKey]));
  for (const l of myLinks) myCanonicals.add(l.canonicalCustomerId);
  const accountProfiles = await db.select({ id: customerProfiles.canonicalCustomerId }).from(customerProfiles).where(inArray(customerProfiles.accountUserId, [userA, userB]));
  for (const p of accountProfiles) myCanonicals.add(p.id);
  const ids = [...myCanonicals];
  if (ids.length) {
    await db.delete(customerFeatureSnapshots).where(inArray(customerFeatureSnapshots.canonicalCustomerId, ids));
    await db.delete(customerLifecycleSnapshots).where(inArray(customerLifecycleSnapshots.canonicalCustomerId, ids));
    await db.delete(customerIdentityLinks).where(inArray(customerIdentityLinks.canonicalCustomerId, ids));
    await db.delete(customerProfiles).where(inArray(customerProfiles.canonicalCustomerId, ids));
  }
  await db.delete(orders).where(inArray(orders.userId, [userA, userB]));
  await db.delete(users).where(inArray(users.id, [userA, userB]));

  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('CUSTOMER_DNA_PROOF_ERROR', e?.message); process.exit(1); });
