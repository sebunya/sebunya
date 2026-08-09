import '../config/env';
import { Registry } from '../infrastructure/Registry';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * Launch-discount activation (operator-delegated, 2026-08-10).
 *
 * Drives the REAL pricing governance chain — create → submit → approve →
 * activate — through PricingOperationsUseCase, so every invariant holds and
 * every step lands in the audit log exactly as an admin click would. Nothing
 * here bypasses the engine; this exists because the campaign the owner approved
 * ("auto 10% off everything, real end date, no stacking") was sitting in
 * production as an inactive draft with typo'd units (10 bps ≈ 0.1%, capped at
 * UGX 30).
 *
 * Idempotent: if the key already exists, it reports the current state and
 * refuses to duplicate. The 10% value sits BELOW the distinct-approver
 * threshold (default 2000 bps), so a single named operator identity may
 * legitimately approve and activate.
 *
 * Usage (builder image on the host, like db:migrate):
 *   ACTOR_USER_ID=<admin uuid> [ENDS_AT=ISO] npx tsx src/scripts/activate-launch-discount.ts
 */
const KEY = 'launch-10';
const PERCENT_BPS = 1000; // 10% — units per docs: 1000 bps = 10%
const ENDS_AT = new Date(process.env.ENDS_AT ?? '2026-09-13T11:54:00Z');

async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin user uuid.');
  if (!(ENDS_AT.getTime() > Date.now())) throw new Error('ENDS_AT must be in the future — an expired campaign cannot activate.');

  const ops = Registry.getInstance().pricingOperationsUseCase;

  const existing = (await ops.list()).find((d: any) => d.key === KEY);
  if (existing) {
    console.log(`REFUSED_DUPLICATE: definition '${KEY}' already exists (status=${existing.status}). Manage it at /admin/pricing.`);
    return;
  }

  const created = await ops.create({
    key: KEY,
    name: 'Launch offer — 10% off everything',
    description: 'Site-wide 10% launch discount, approved by the owner: automatic (no code), no stacking, real end date. Display mirrors the evaluator penny-for-penny.',
    actorId,
    version: {
      conditions: [],
      benefits: [{ type: 'PERCENTAGE_OFF', value: PERCENT_BPS, maximumDiscountUgx: null }],
      exclusions: [],
      schedule: { startsAt: new Date(Date.now() - 60_000), endsAt: ENDS_AT },
      usagePolicy: { globalLimit: null, perCustomerLimit: null, perCouponLimit: null, reservationTtlSeconds: 900 },
      priority: 100,
      stackable: false,
      couponCode: null,
      priceFloorUgx: 0,
    },
  });
  console.log(`created definition=${created.definition.id} version=${created.version.id}`);

  const step = async (op: 'submit' | 'approve' | 'activate', to: 'READY_FOR_REVIEW' | 'APPROVED' | 'ACTIVE') => {
    // Fresh optimistic revision each step, from the typed definition record.
    const record = (await ops.list()).find((d) => d.key === KEY);
    if (!record) throw new Error(`Definition '${KEY}' vanished mid-flight.`);
    const result = await ops.transition({
      definitionId: created.definition.id,
      versionId: created.version.id,
      expectedRevision: record.revision,
      to,
      actorId,
      reason: `Launch 10% activation (owner-approved): ${op}.`,
    });
    console.log(`${op} -> ${to} ok (from revision ${record.revision})`);
    return result;
  };
  await step('submit', 'READY_FOR_REVIEW');
  await step('approve', 'APPROVED');
  await step('activate', 'ACTIVE');

  const active = await Registry.getInstance().pricingRepo.listActiveVersions(new Date());
  const mine = active.find((row: any) => row.definition.key === KEY);
  if (!mine) throw new Error('VERIFY_FAILED: the version did not appear in listActiveVersions.');
  console.log(`ACTIVE_OK: ${mine.definition.name} — ${PERCENT_BPS} bps until ${ENDS_AT.toISOString()}`);
}

main()
  .then(async () => { await endDbConnection(); process.exit(0); })
  .catch(async (error) => { console.error('ACTIVATION_FAILED:', error instanceof Error ? error.message : error); await endDbConnection(); process.exit(1); });
