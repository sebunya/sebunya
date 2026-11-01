/**
 * Nightly calibration from the command line.
 *
 * The same use case the Control Centre's "Run now" button calls
 * (POST /admin/delivery/calibration/run). It PROPOSES, never applies: learned
 * factors, the per-area with-pin split, re-band flags and window percentiles
 * land in the proposal queue for a person to accept. Running it twice changes
 * nothing (pending proposals are replaced wholesale).
 *
 * Before 2026-10-16 nothing on the host ran this: the queue only filled when
 * someone pressed the button. ops/delivery-nightly installs the timer.
 *
 * Usage: pnpm -F @goldplus/api delivery:calibrate
 *   or, in the running api container: node apps/api/dist/scripts/delivery-nightly-calibration.js
 */
import '../config/env';
import { Registry } from '../infrastructure/Registry';

async function main(): Promise<void> {
  const r = await Registry.getInstance().runNightlyCalibrationUseCase.execute();
  const fitted = r.outcomes.filter((o) => o.outcome.kind === 'fitted').length;
  console.log(
    `CALIBRATION_OK observations=${r.observations} proposals=${r.proposalsCreated} fitted=${fitted} reband_flags=${r.rebandFlags.length}` +
      (r.firstObservationAlert?.fired ? ' FIRST_OBSERVATION' : ''),
  );
  if (r.observations === 0 && r.emptiness) console.log(`NOTE ${r.emptiness.has}; ${r.emptiness.missing}; ${r.emptiness.needs}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.stack ?? String(e));
    process.exit(1);
  });
