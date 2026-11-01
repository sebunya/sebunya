import '../config/env';
import { Registry } from '../infrastructure/Registry';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * Correct a hero headline that overstates the campaign (operator-delegated).
 *
 * The flash slide read "{pct}% discount on everything". With a per-unit price
 * floor in force that is not true: an item already at the floor comes down by
 * nothing, so the campaign takes off less than the headline promises. The same
 * claim was corrected in the nav and the code defaults; this is the LIVE row,
 * which is where the storefront actually reads it from.
 *
 * Drives the real repository so the change is attributed and versioned exactly
 * as an edit in /admin/hero would be. Idempotent: a slide that already reads
 * correctly is reported and skipped.
 *
 * Usage:
 *   ACTOR_USER_ID=<admin uuid> npx tsx src/scripts/correct-hero-claim.ts [--apply]
 */
async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');
  const apply = process.argv.includes('--apply');

  const repo = Registry.getInstance().heroRepo;
  const slides = await repo.listAll();

  for (const slide of slides) {
    const headline = String((slide as { headline?: string }).headline ?? '');

    // Two corrections, both replacing a NUMBER in the copy with a token the
    // renderer fills from live config, so the slide cannot go stale:
    //   "on everything"  -> the floor means it is not on everything
    //   "5pm"            -> the cutoff is operator-set in business_info
    const corrected = headline
      .replace(/<em>\{pct\}% discount<\/em>\s*on everything/i, 'Up to <em>{pct}% off</em>')
      .replace(/\{pct\}% discount on everything/i, 'Up to {pct}% off')
      .replace(/\s*on everything/i, '')
      .replace(/\b5\s*pm\b/i, '{cutoff}');
    if (corrected === headline) continue;

    console.log(`slide=${(slide as { slideKey?: string }).slideKey}`);
    console.log(`  was: ${headline}`);
    console.log(`  now: ${corrected}`);
    if (!apply) { console.log('  (dry run — pass --apply to write)'); continue; }

    const updated = await repo.updateSlide(
      String((slide as { slideKey?: string }).slideKey),
      { headline: corrected } as never,
      actorId,
    );
    console.log(updated ? '  APPLIED' : '  NOT FOUND');
  }
}

main()
  .then(() => endDbConnection())
  .catch(async (err) => {
    console.error('FAILED', err);
    await endDbConnection();
    process.exitCode = 1;
  });
