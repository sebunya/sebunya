import { Registry } from '../Registry';
import { logger } from '../logging/logger';
import type { StitchInput } from '../../application/use-cases/first-party/StitchCustomerIdentityUseCase';

/**
 * Fire-and-forget identity stitching for request paths (sign-in, registration,
 * checkout). Never awaited by the caller and never throws: identity is
 * continuity, not correctness, so a failure here can never fail a sign-in or
 * an order. Off under NODE_ENV=test (the hermetic suite has no database) and
 * when IDENTITY_STITCHING=off (the rollback switch).
 */
export function stitchInBackground(input: StitchInput): void {
  if (process.env.NODE_ENV === 'test') return;
  if ((process.env.IDENTITY_STITCHING ?? '').trim().toLowerCase() === 'off') return;
  void Promise.resolve()
    .then(() => Registry.getInstance().stitchCustomerIdentityUseCase.execute(input))
    .then((r) => {
      if (r.conflicts > 0 || r.foldedGuests > 0 || r.claimedGuest) {
        logger.info({ moment: input.moment, linked: r.linked, conflicts: r.conflicts, folded: r.foldedGuests, claimed: r.claimedGuest }, '[identity-stitch] outcome');
      }
    })
    // The message only: an error object can carry the SQL parameters (contact values).
    .catch((err: unknown) => logger.warn({ moment: input.moment, error: err instanceof Error ? err.message.slice(0, 200) : 'unknown' }, '[identity-stitch] failed'));
}
