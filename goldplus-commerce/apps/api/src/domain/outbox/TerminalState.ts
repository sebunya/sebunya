/**
 * The dead-letter state, read across two historical spellings.
 *
 * Production holds both. `DrizzleOutboxRepository.markDeadLettered` writes
 * `dead_letter`; `TelemetryDispatchService` writes `dead_lettered`. Every
 * reader was written against the first one only, so the five TELEMETRY_DISPATCH
 * dead letters are — today — uncountable by `metrics()`, invisible to the
 * operator dead-letter list, and UNREPLAYABLE, because the replay lookup filters
 * on the single literal too.
 *
 * That is the real cost, and it is why this is not a cosmetic issue: an
 * undelivered event that no query returns is indistinguishable from one that
 * never existed. The monitoring said zero because it asked the wrong question.
 *
 * The fix is asymmetric on purpose:
 *
 *   WRITES  -> DEAD_LETTER_STATE, one value, forever.
 *   READS   -> DEAD_LETTER_STATES, both values, until an explicit, approved
 *              cleanup migrates the history.
 *
 * Rewriting the existing rows to tidy the column would be a production data
 * mutation performed to make a table look neat, and it would destroy the
 * evidence of which writer produced them. Reading both costs one extra literal.
 */

/** The only value new code may write. */
export const DEAD_LETTER_STATE = 'dead_letter' as const;

/** Every value that has ever meant "dead-lettered". Readers must accept all. */
export const DEAD_LETTER_STATES: readonly string[] = Object.freeze([
  'dead_letter',
  'dead_lettered',
]);

export const isDeadLettered = (status: string | null | undefined): boolean =>
  typeof status === 'string' && DEAD_LETTER_STATES.includes(status);
