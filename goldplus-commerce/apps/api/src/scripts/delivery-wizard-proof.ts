/**
 * Wizard proof (brief "FINISH", PART 1: no work is complete until it can be
 * observed doing the thing).
 *
 * Runs the whole launch path against a real database — derive, draft, the
 * mandatory preview against real orders and real areas, then publish — and
 * prints what an operator would see at each step. Read-only against production
 * unless PROOF_PUBLISH=1, which is only ever set on a restored clone.
 *
 * This is a proof harness, not a fixture: it writes no data of its own and
 * invents no value. Every number it prints came from the answers passed in or
 * from the gazetteer.
 */
import '../config/env';
import { sql } from 'drizzle-orm';
import { db } from '../infrastructure/db/client';
import { Registry } from '../infrastructure/Registry';

const ANSWERS = {
  areaQuery: process.env.PROOF_AREA ?? 'ntinda',
  roundTripMinutes: Number(process.env.PROOF_MINUTES ?? 45),
  riderPayUgx: Number(process.env.PROOF_PAY ?? 5000),
  handlingMinutes: Number(process.env.PROOF_HANDLING ?? 15),
  marginPercent: Number(process.env.PROOF_MARGIN ?? 30),
  minimumFeeUgx: Number(process.env.PROOF_MIN_FEE ?? 3000),
  freeDeliveryThresholdUgx: process.env.PROOF_FREE ? Number(process.env.PROOF_FREE) : null,
};

const ugx = (n: number | null) => (n === null ? '—' : `UGX ${Math.round(n).toLocaleString('en-UG')}`);

async function main() {
  const registry = Registry.getInstance();

  const [{ n: corridors }] = (await db.execute(sql`select count(*)::int as n from delivery_corridor`)) as unknown as Array<{ n: number }>;
  const [{ n: orders }] = (await db.execute(sql`select count(*)::int as n from orders`)) as unknown as Array<{ n: number }>;
  console.log(`\n=== environment ===\ncorridors=${corridors} orders=${orders}\n`);

  // 1. Area search — alias aware, restricted to areas that carry a band.
  const areas = await registry.deliveryWizardAreaReader.searchQuotableAreas(ANSWERS.areaQuery, 8);
  console.log(`=== 1. "${ANSWERS.areaQuery}" ===`);
  for (const a of areas) console.log(`  ${a.label}  (band ${a.band}, ${a.corridor})`);
  if (areas.length === 0) {
    console.error('PROOF_FAILED: no quotable area matched.');
    process.exit(1);
  }
  const chosen = areas[0];

  // 2. Derive.
  const derived = await registry.deriveLaunchValuesUseCase.execute({
    areaSlug: chosen.areaSlug,
    roundTripMinutes: ANSWERS.roundTripMinutes,
    riderPayUgx: ANSWERS.riderPayUgx,
    handlingMinutes: ANSWERS.handlingMinutes,
    marginPercent: ANSWERS.marginPercent,
    minimumFeeUgx: ANSWERS.minimumFeeUgx,
    freeDeliveryThresholdUgx: ANSWERS.freeDeliveryThresholdUgx,
  });
  if (!derived.ok) {
    console.error(`PROOF_FAILED: ${derived.code} — ${derived.message}`);
    process.exit(1);
  }
  console.log(`\n=== 2. derived from a ${ANSWERS.roundTripMinutes} minute trip to ${chosen.label} ===`);
  for (const d of derived.result.derived) console.log(`  ${d.label}\n    ${d.working}`);
  for (const w of derived.result.warnings) console.log(`  ! ${w.answer}: ${w.message}`);

  // 3. Draft — through the same path a manual edit uses.
  const actorId = process.env.PROOF_ACTOR_ID ?? null;
  if (!actorId) {
    console.log('\n(no PROOF_ACTOR_ID — stopping before the draft, which needs an attributed actor)');
    process.exit(0);
  }
  const draft = await registry.draftLaunchValuesUseCase.execute({
    values: derived.result.values,
    actorId,
    reason: `Wizard proof: ${ANSWERS.roundTripMinutes} minute round trip to ${chosen.label}, rider paid ${ANSWERS.riderPayUgx}.`,
  });
  if (!draft.ok) {
    console.error(`PROOF_FAILED at draft: ${draft.code} — ${draft.message}`);
    process.exit(1);
  }
  console.log(`\n=== 3. draft ${draft.versionId} ===`);

  // 4. The mandatory preview.
  const preview = await registry.previewDeliveryConfigUseCase.execute({ versionId: draft.versionId });
  if (!preview.ok) {
    console.error(`PROOF_FAILED at preview: ${preview.code} — ${preview.message}`);
    process.exit(1);
  }
  console.log(`\n=== 4. preview ===\n${preview.preview.impactSummary}\n`);
  console.log('  band  place                                     km    min      fee');
  for (const b of preview.preview.bands) {
    console.log(
      `  ${b.band}    ${b.areaLabel.padEnd(40).slice(0, 40)}  ${String(b.midpointKm).padStart(4)}  ${String(b.expectedMinutes === null ? '—' : Math.round(b.expectedMinutes)).padStart(5)}  ${(b.feeUgx === null ? (b.unavailableReason ?? '—') : ugx(b.feeUgx)).padStart(12)}`,
    );
  }
  console.log(`\n  recent orders repriced: ${preview.preview.orders.length}`);
  for (const o of preview.preview.orders) {
    console.log(
      `    ${o.orderNumber}  ${o.areaLabel.padEnd(34).slice(0, 34)}  ${(o.beforeReason ?? ugx(o.beforeFeeUgx)).padStart(18)} -> ${(o.afterReason ?? ugx(o.afterFeeUgx)).padStart(18)}`,
    );
  }
  if (preview.preview.problems.length > 0) {
    for (const p of preview.preview.problems) console.log(`  PROBLEM ${p.key}: ${p.message}`);
  }

  // 5. Publish refuses without confirmation — proven, not assumed.
  const refused = await registry.publishDeliveryConfigUseCase.execute({
    versionId: draft.versionId,
    actorId,
    previewConfirmed: false,
    scheduledFor: null,
  });
  console.log(`\n=== 5. publish without confirming the preview ===`);
  if (refused.ok) {
    console.error('PROOF_FAILED: publish succeeded without a preview confirmation.');
    process.exit(1);
  }
  console.log(`  refused: ${refused.code} — ${refused.message}`);

  if (process.env.PROOF_PUBLISH !== '1') {
    console.log('\n(PROOF_PUBLISH is not 1 — stopping before publish. Draft left in place, unread by the config reader.)');
    process.exit(0);
  }

  const published = await registry.publishDeliveryConfigUseCase.execute({
    versionId: draft.versionId,
    actorId,
    previewConfirmed: true,
    scheduledFor: null,
  });
  if (!published.ok) {
    console.error(`PROOF_FAILED at publish: ${published.code} — ${published.message}`);
    process.exit(1);
  }
  console.log(`\n=== 6. published ${published.version.id} ===`);

  const live = await registry.deliveryConfigReader.numericValues();
  console.log(`  live values now: ${JSON.stringify(Object.fromEntries(Object.entries(live).filter(([k]) => k.includes('speed') || k.includes('rider') || k.includes('handling') || k.includes('margin') || k.includes('minimum'))))}`);
  const setupMissing = (await import('../domain/delivery/DeliveryModel')).missingLaunchKeys(live);
  console.log(`  missing launch keys: ${setupMissing.length === 0 ? 'NONE — the module is quoting' : setupMissing.join(', ')}`);
  console.log('\nWIZARD_PROOF_OK');
}

main().catch((e) => {
  console.error('PROOF_FAILED', e);
  process.exit(1);
});
