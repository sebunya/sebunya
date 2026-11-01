import { describe, expect, it } from 'vitest';
import { checkCallbackSilence } from '../../apps/api/src/application/use-cases/payments/PaymentSilenceUseCases';

/**
 * The detector for the failure that cost this shop every payment it ever took:
 * the provider was handed a callback URL it could not reach, so every attempt
 * got a redirect and then silence, for four months, with nothing to say so.
 *
 * It deliberately needs no configured window — an operator setting is exactly
 * what was missing last time.
 */
const reader = (awaiting: number, total: number) => ({
  callbackSilence: async () => ({ awaiting, total }),
});

describe('has the payment provider called back about anything?', () => {
  it('says nothing when there is nothing to judge', async () => {
    expect(await checkCallbackSilence(reader(0, 0))).toEqual({ state: 'no_attempts' });
  });

  it('is quiet while callbacks are arriving', async () => {
    expect(await checkCallbackSilence(reader(0, 5))).toEqual({ state: 'ok' });
  });

  it('tolerates a single straggler among many', async () => {
    // One attempt still waiting is ordinary: a customer who wandered off.
    expect(await checkCallbackSilence(reader(1, 5))).toEqual({ state: 'ok' });
  });

  it('raises the alarm when EVERY settled attempt heard nothing back', async () => {
    // This is the shape of a blocked callback URL, and it is what production
    // looked like for four months: 13 attempts, 13 with no IPN and no return.
    expect(await checkCallbackSilence(reader(13, 13))).toEqual({
      state: 'PROVIDER_NEVER_CALLS_BACK',
      awaiting: 13,
      total: 13,
    });
  });

  it('only judges attempts old enough to have been called back', async () => {
    const seen: Array<{ olderThan: Date; since: Date }> = [];
    const spy = {
      callbackSilence: async (olderThan: Date, since: Date) => {
        seen.push({ olderThan, since });
        return { awaiting: 0, total: 0 };
      },
    };
    const now = new Date('2026-08-29T12:00:00Z');
    await checkCallbackSilence(spy, now, { quietMinutes: 60, windowHours: 72 });
    // A minute-old attempt must not count as evidence of anything.
    expect(seen[0].olderThan.toISOString()).toBe('2026-08-29T11:00:00.000Z');
    expect(seen[0].since.toISOString()).toBe('2026-08-26T12:00:00.000Z');
  });
});
