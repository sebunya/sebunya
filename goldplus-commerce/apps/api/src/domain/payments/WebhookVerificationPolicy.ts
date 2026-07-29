/**
 * What to do with a payment webhook whose signature did not verify.
 *
 * Pure domain, because this is the single decision that separates "a payment
 * happened" from "someone said a payment happened", and it should be readable
 * and testable without a database or an HTTP framework anywhere near it.
 */

export type WebhookVerificationDecision =
  /** Authenticated. Record normally. */
  | { action: 'ACCEPT'; requiresReview: false }
  /**
   * Not authenticated, but grace mode is on for this provider. Record it,
   * permanently marked unverified and held for human confirmation.
   */
  | { action: 'ACCEPT_UNVERIFIED'; requiresReview: true; reason: string }
  /** Not authenticated. Record nothing. */
  | { action: 'REJECT'; reason: 'SIGNATURE_INVALID' | 'NOT_CONFIGURED' };

export interface WebhookVerificationInput {
  signatureVerified: boolean;
  /** Whether a signing secret exists for this provider at all. */
  secretConfigured: boolean;
  /** Grace mode, per provider. Default off. */
  graceEnabled: boolean;
}

/**
 * Grace mode is deliberately narrow.
 *
 * It exists so a deployment whose provider secrets are not yet configured can
 * keep taking callbacks while that is fixed — not so unsigned traffic becomes
 * ordinarily acceptable. Two limits make that real:
 *
 *  1. It only applies when NO secret is configured. If a secret IS configured
 *     and the signature still fails, that is not a configuration gap — it is a
 *     wrong or forged signature, and it is rejected whatever the flag says.
 *     Without this limit, turning the flag on would disable signature checking
 *     entirely rather than bridging a configuration gap.
 *
 *  2. Anything it accepts is marked `requiresReview`, so it cannot be mistaken
 *     for an authenticated payment by any later reader.
 */
export function decideWebhookVerification(
  input: WebhookVerificationInput,
): WebhookVerificationDecision {
  if (input.signatureVerified) {
    return { action: 'ACCEPT', requiresReview: false };
  }

  if (input.secretConfigured) {
    // A configured secret that did not match is a bad signature, not a gap.
    return { action: 'REJECT', reason: 'SIGNATURE_INVALID' };
  }

  if (!input.graceEnabled) {
    return { action: 'REJECT', reason: 'NOT_CONFIGURED' };
  }

  return {
    action: 'ACCEPT_UNVERIFIED',
    requiresReview: true,
    reason:
      'No signing secret is configured for this provider, so the payment could not be ' +
      'authenticated. It is recorded and held for manual confirmation.',
  };
}

/**
 * Reads the per-provider grace flag.
 *
 * Off unless explicitly and exactly enabled: any other value — empty, "1",
 * "yes", a typo — is off. A flag that disables payment authentication should
 * never be switched on by an ambiguous string.
 */
export function graceEnabledFor(provider: string, env: NodeJS.ProcessEnv): boolean {
  const global = env.PAYMENT_WEBHOOK_UNVERIFIED_GRACE;
  const perProvider = env[`PAYMENT_WEBHOOK_UNVERIFIED_GRACE_${provider.toUpperCase()}`];
  return perProvider === 'true' || (perProvider === undefined && global === 'true');
}
