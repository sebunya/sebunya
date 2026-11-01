import '../config/env';
import { Registry } from '../infrastructure/Registry';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * Attribution v2 (2026-10-29), applied to the past once, at deploy:
 *  1. Every recorded touch's channel is re-derived from its recorded fields with today's classifier
 *     (ReclassifyTouchesUseCase): webmail and mail apps are email, not Google or Yahoo search; more AI assistants.
 *  2. Every order placed in DAYS (default 400) is re-credited under channel-credit-v2 (direct visits take no credit
 *     from a recorded source; an answer beats a direct-only journey). The nightly batch reaches back 120 days only,
 *     and a report spanning older weeks would otherwise mix v1 and v2 rows.
 *
 *   ACTOR_USER_ID=<admin uuid> [DAYS=400] [DRY_RUN=1] npx tsx src/scripts/reclassify-attribution.ts
 *
 * A dry run lists the channel changes (old → new, counts only) and writes nothing. The live run is audited as
 * ATTRIBUTION_RECOMPUTED, like the channel report's Recompute button. No personal data is read or printed.
 */
async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1';
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!dryRun && !/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid for a live run.');
  const days = Math.min(400, Math.max(1, Number(process.env.DAYS ?? 400) || 400));
  const r = Registry.getInstance();

  const touches = await r.channelAttribution.reclassifyTouches.execute({ days, dryRun });
  console.log(`touches: scanned ${touches.scanned}, would change ${touches.changed}${dryRun ? '' : `, rewritten ${touches.written}`}${touches.capped ? ' (CAPPED: run again)' : ''}`);
  for (const [k, n] of Object.entries(touches.changes).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
  if (dryRun) { console.log('DRY RUN: nothing written, no order re-credited'); return; }

  const orders = await r.channelAttribution.backfill.execute({ days });
  console.log(`orders re-credited: ${orders.orders}, failed ${orders.failed}${orders.capped ? ' (CAPPED at 2000: press Recompute for the rest)' : ''}`);
  await r.createAuditLogUseCase.execute({
    actorId, action: 'ATTRIBUTION_RECOMPUTED', entity: 'attribution', entityId: 'order_channel_credit',
    newState: { reason: 'Attribution v2 at deploy: direct rule, reclassified touches', days, touches: { scanned: touches.scanned, rewritten: touches.written, changes: touches.changes }, ...orders },
  });
  if (orders.failed > 0) process.exitCode = 1;
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
