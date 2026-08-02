/**
 * MFA / step-up policy. Pure domain — no crypto, DB or Hono.
 *
 * "Has MFA enabled" is not the same as "just proved MFA". A privileged action
 * requires a RECENT proof (step-up freshness), so a session left open for hours
 * cannot approve a price or publish a catalogue on the strength of a factor
 * verified this morning.
 */

/** How recently MFA must have been verified for a step-up to count. */
export const STEP_UP_FRESHNESS_MS = 5 * 60_000; // 5 minutes

/** Recovery-code shape. */
export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_BYTES = 5; // 10 hex chars per code

/**
 * The privileged actions that require MFA. A privileged user cannot opt out —
 * if the action is here and the user lacks a fresh factor, it is denied, not
 * downgraded. This is the self-bypass denial.
 */
export const MFA_REQUIRED_ACTIONS = [
  'user_admin',
  'role_admin',
  'pricing_approval',
  'catalogue_publication',
  'credential_management',
  'controlled_activation',
  'canary_control',
  'sensitive_export',
  'release_approval',
] as const;

export type PrivilegedAction = (typeof MFA_REQUIRED_ACTIONS)[number];

export function requiresMfa(action: string): action is PrivilegedAction {
  return (MFA_REQUIRED_ACTIONS as readonly string[]).includes(action);
}

/** Whether a verification at `lastVerifiedAt` is still fresh enough at `now`. */
export function isStepUpFresh(lastVerifiedAt: Date | null | undefined, now: Date): boolean {
  if (!lastVerifiedAt) return false;
  const age = now.getTime() - lastVerifiedAt.getTime();
  return age >= 0 && age <= STEP_UP_FRESHNESS_MS;
}

export type StepUpDecision =
  | { action: 'ALLOW' }
  | { action: 'ENROL_REQUIRED' }
  | { action: 'STEP_UP_REQUIRED' };

/**
 * The gate for a privileged action.
 *  - not privileged                     -> ALLOW (this gate is not for it)
 *  - privileged, no confirmed MFA       -> ENROL_REQUIRED (cannot bypass)
 *  - privileged, MFA but stale proof    -> STEP_UP_REQUIRED
 *  - privileged, MFA and fresh proof    -> ALLOW
 */
export function decideStepUp(input: {
  action: string;
  mfaConfirmed: boolean;
  lastVerifiedAt: Date | null | undefined;
  now: Date;
}): StepUpDecision {
  if (!requiresMfa(input.action)) return { action: 'ALLOW' };
  if (!input.mfaConfirmed) return { action: 'ENROL_REQUIRED' };
  return isStepUpFresh(input.lastVerifiedAt, input.now)
    ? { action: 'ALLOW' }
    : { action: 'STEP_UP_REQUIRED' };
}
