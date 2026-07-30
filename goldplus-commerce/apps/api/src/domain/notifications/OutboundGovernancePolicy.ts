/**
 * One outbound-delivery policy, for every channel.
 *
 * WHAT WAS WRONG
 * Each provider interpreted the environment flags itself. The gates were individually
 * defensible, but they were not the same gates, and they did not agree:
 *
 *   - `NOTIFICATIONS_DRY_RUN` produced `status: 'SENT'` with providerCode
 *     `DRY_RUN_SUCCESS` in BOTH the email and SMS adapters. A suppressed message was
 *     therefore indistinguishable from a delivered one in every metric, dashboard and
 *     query — the exact confusion that made "did we message customers?" unanswerable
 *     from the data.
 *   - the recipient allowlist was applied BEFORE the dry-run check in SMS and after
 *     credential validation in email, so the same environment refused different
 *     messages depending on which channel carried them.
 *   - `PROVIDER_DELIVERY_ENABLED` and `CUSTOMER_COMMUNICATIONS_ENABLED` — the flags the
 *     programme treats as the master outbound gates — were consulted by NEITHER
 *     adapter. They were enforced only by convention.
 *   - each new channel re-derived the whole thing. Correctness repeated per provider is
 *     a defect waiting for the third provider, and WhatsApp already exists.
 *
 * WHAT THIS IS
 * A pure decision function. No Hono, no Drizzle, no provider SDK, no environment
 * reading — the caller passes a snapshot, so every branch is exhaustively testable and
 * the same input always yields the same decision. Providers ask; they do not decide.
 *
 * ORDERING IS PART OF THE CONTRACT
 * Guards are evaluated most-global first, and the FIRST failure is the answer. That
 * matters for two reasons: the reported reason is stable (a globally disabled system
 * always says so, rather than reporting whichever narrower guard happened to be checked
 * first), and a message blocked globally never has its recipient's consent or frequency
 * examined — work that would otherwise read customer data to answer a question already
 * settled.
 */

export type OutboundChannel = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'PUSH';

/**
 * What kind of message this is. The distinction is not cosmetic: an operational message
 * to staff and a marketing message to a customer are governed differently, and treating
 * them alike is how a marketing send rides through an operational allowance.
 */
export type MessageClass =
  /** Internal operations: an admin alert, a dispatch notice. */
  | 'OPERATIONAL'
  /** Transactional to a customer: an order confirmation, a payment receipt. */
  | 'TRANSACTIONAL'
  /** Marketing to a customer. Requires consent, always. */
  | 'MARKETING';

export type RecipientClass =
  /** A member of staff on an internal address. */
  | 'INTERNAL'
  /** A real customer. */
  | 'CUSTOMER'
  /** An address on the test allowlist. */
  | 'TEST';

export type OutboundDecisionKind =
  /** Simulate and record the simulation. NEVER recorded as delivered. */
  | 'ALLOW_DRY_RUN'
  /** Perform the real network call. */
  | 'ALLOW_LIVE'
  | 'BLOCK_GLOBAL_DISABLED'
  | 'BLOCK_CHANNEL_DISABLED'
  | 'BLOCK_APPROVAL_REQUIRED'
  | 'BLOCK_PROVIDER_NOT_CONFIGURED'
  | 'BLOCK_SERVICE_UNHEALTHY'
  | 'BLOCK_RECIPIENT_NOT_ALLOWLISTED'
  | 'BLOCK_CONSENT'
  | 'BLOCK_SUPPRESSION'
  | 'BLOCK_FREQUENCY_CAP'
  /** The configuration itself is contradictory. See the note below. */
  | 'BLOCK_UNSAFE_CONFIGURATION';

export interface OutboundDecision {
  kind: OutboundDecisionKind;
  /**
   * The guard that produced this decision, named exactly.
   *
   * Not a prose message. An operator seeing BLOCK_UNSAFE_CONFIGURATION needs to know
   * WHICH flag combination is wrong, and a dashboard needs to group by it — a sentence
   * does neither, and the previous WARN buried precisely this in a message string.
   */
  guard: string;
  /** True only for ALLOW_LIVE. Exists so no caller has to re-derive it. */
  live: boolean;
}

/**
 * The flags, as a snapshot.
 *
 * Read once by the caller and passed in, so a decision cannot change halfway through
 * because someone edited the environment, and so tests need no environment at all.
 */
export interface OutboundFlags {
  /** Master switch. False means nothing leaves this system, by any channel. */
  providerDeliveryEnabled: boolean;
  /** Customer-facing communications specifically. */
  customerCommunicationsEnabled: boolean;
  /** The notification subsystem as a whole. */
  notificationDeliveryEnabled: boolean;
  /** Live sending, as opposed to simulation. */
  liveSendEnabled: boolean;
  /** Per-channel enablement. */
  channelEnabled: boolean;
  /** True when the system should simulate rather than send. */
  dryRun: boolean;
  /** An operator has approved live sending for this environment. */
  operatorApproved: boolean;
}

export interface OutboundContext {
  channel: OutboundChannel;
  messageClass: MessageClass;
  recipientClass: RecipientClass;
  /** False when the provider's credentials are missing or malformed. */
  providerConfigured: boolean;
  /** False when a health check says the provider or subsystem is degraded. */
  serviceHealthy: boolean;
  /**
   * Whether an allowlist is in force, and whether this recipient is on it.
   * `allowlistActive: false` means no allowlist is configured.
   */
  allowlistActive: boolean;
  recipientAllowlisted: boolean;
  /** Consent state for a customer recipient. Ignored for INTERNAL. */
  consentGranted: boolean;
  /** The recipient has asked not to be contacted, or hard-bounced. */
  suppressed: boolean;
  /** This send would exceed the frequency cap for this recipient. */
  frequencyCapReached: boolean;
}

/**
 * Configurations that are internally contradictory.
 *
 * Returned as a BLOCK, never a WARN. A safety check must not pass in the case it exists
 * to detect: the previous email config check returned `status: 'PASS'` with the warning
 * buried in a message string, so an environment with outbound email unlocked and the
 * dry-run guard off reported the same status as a correctly locked-down one. Anything
 * scanning statuses saw PASS.
 *
 * Each entry names the guard so the operator is told which combination is wrong rather
 * than being handed a paragraph.
 */
function unsafeConfiguration(flags: OutboundFlags): string | null {
  // Only genuine CONTRADICTIONS belong here — arrangements where the flags express two
  // incompatible intentions, so acting on them at all means guessing which one the
  // operator meant.
  //
  // A missing operator approval is deliberately NOT one of them. It is a legitimate,
  // expected state (nobody has approved live sending yet), and reporting it as an
  // unsafe configuration would both fail release readiness for a correctly locked-down
  // deployment and mask whichever narrower guard was the real answer. It is handled by
  // BLOCK_APPROVAL_REQUIRED at the point where sending is actually decided.
  //
  // Dry-run and live-send both on. Contradictory instructions, and resolving them
  // silently either way is worse than refusing: one reading sends real messages when
  // someone believed they were simulating.
  if (flags.dryRun && flags.liveSendEnabled) {
    return 'DRY_RUN_AND_LIVE_SEND_BOTH_ENABLED';
  }
  // Customer communications on while the master provider switch is off. The narrower
  // flag appears to grant something the broader one forbids, so the configuration does
  // not express a coherent intention.
  if (flags.customerCommunicationsEnabled && !flags.providerDeliveryEnabled) {
    return 'CUSTOMER_COMMUNICATIONS_WITHOUT_PROVIDER_DELIVERY';
  }
  return null;
}

/**
 * Decides what may happen to one outbound message.
 *
 * Exhaustive and ordered. Every return names its guard.
 */
export function decideOutbound(
  flags: OutboundFlags,
  context: OutboundContext,
): OutboundDecision {
  const block = (kind: OutboundDecisionKind, guard: string): OutboundDecision => ({
    kind,
    guard,
    live: false,
  });

  // 0. A contradictory configuration is refused before anything else. Acting on it at
  //    all means guessing which of two conflicting instructions the operator meant.
  const unsafe = unsafeConfiguration(flags);
  if (unsafe) return block('BLOCK_UNSAFE_CONFIGURATION', unsafe);

  // 1. The master switch. Nothing leaves the system.
  if (!flags.providerDeliveryEnabled) {
    return block('BLOCK_GLOBAL_DISABLED', 'PROVIDER_DELIVERY_ENABLED');
  }
  if (!flags.notificationDeliveryEnabled) {
    return block('BLOCK_GLOBAL_DISABLED', 'NOTIFICATION_DELIVERY_ENABLED');
  }

  // 2. Customer-facing communications, specifically. An OPERATIONAL message to staff is
  //    not governed by this flag — that is the whole reason the two exist separately.
  if (context.messageClass !== 'OPERATIONAL' && !flags.customerCommunicationsEnabled) {
    return block('BLOCK_GLOBAL_DISABLED', 'CUSTOMER_COMMUNICATIONS_ENABLED');
  }

  // 3. This channel.
  if (!flags.channelEnabled) {
    return block('BLOCK_CHANNEL_DISABLED', `${context.channel}_CHANNEL_ENABLED`);
  }

  // 4. Can the provider even be called? Checked before recipient rules so an
  //    unconfigured provider is not reported as a consent problem.
  if (!context.providerConfigured) {
    return block('BLOCK_PROVIDER_NOT_CONFIGURED', `${context.channel}_CREDENTIALS`);
  }
  if (!context.serviceHealthy) {
    return block('BLOCK_SERVICE_UNHEALTHY', `${context.channel}_HEALTH`);
  }

  // 5. Recipient-level rules. Suppression outranks consent: a person who asked not to be
  //    contacted must not be reachable because a consent record says otherwise.
  if (context.suppressed) {
    return block('BLOCK_SUPPRESSION', 'RECIPIENT_SUPPRESSED');
  }

  // Consent applies to customers. MARKETING always requires it; TRANSACTIONAL to a
  // customer requires it too, because this platform has not established a lawful basis
  // for contacting a customer who has refused. INTERNAL recipients are staff on
  // corporate addresses and are governed by employment, not consent.
  if (context.recipientClass === 'CUSTOMER' && !context.consentGranted) {
    return block('BLOCK_CONSENT', `NO_CONSENT_FOR_${context.messageClass}`);
  }

  // Frequency caps protect the recipient from volume. Applied after consent so a
  // consent failure is never reported as a volume problem.
  if (context.frequencyCapReached) {
    return block('BLOCK_FREQUENCY_CAP', 'RECIPIENT_FREQUENCY_CAP');
  }

  // 6. The allowlist, when one is in force. This is a pre-production containment
  //    control: with an allowlist configured, anything not on it is blocked outright
  //    rather than quietly downgraded to a dry run, because a downgrade would look like
  //    a successful send in the record.
  if (context.allowlistActive && !context.recipientAllowlisted) {
    return block('BLOCK_RECIPIENT_NOT_ALLOWLISTED', 'NOTIFICATIONS_ALLOWED_TEST_RECIPIENTS');
  }

  // 7. Simulate or send.
  if (flags.dryRun) {
    // ALLOW_DRY_RUN is deliberately NOT a success. The caller must record it as a
    // simulation: both adapters previously returned SENT with a DRY_RUN_SUCCESS code,
    // which made a suppressed message indistinguishable from a delivered one.
    return { kind: 'ALLOW_DRY_RUN', guard: 'NOTIFICATIONS_DRY_RUN', live: false };
  }

  if (!flags.liveSendEnabled) {
    return block('BLOCK_APPROVAL_REQUIRED', 'NOTIFICATIONS_LIVE_SEND_ENABLED');
  }
  if (!flags.operatorApproved) {
    // The human decision this system must not make for itself. Reached only when
    // everything else already permits a live send, which is exactly when an operator's
    // approval is the remaining question.
    return block('BLOCK_APPROVAL_REQUIRED', 'NOTIFICATIONS_OPERATOR_APPROVED');
  }

  return { kind: 'ALLOW_LIVE', guard: 'NONE', live: true };
}

/** True when the decision permits any network call at all. */
export function permitsNetworkCall(decision: OutboundDecision): boolean {
  return decision.kind === 'ALLOW_LIVE';
}

/**
 * True when this decision must fail release readiness and block activation.
 *
 * Only an unsafe CONFIGURATION does. A message blocked because a customer withheld
 * consent is the system working correctly; a contradictory set of flags is a deployment
 * that must not be released, and conflating the two would either make consent failures
 * block releases or let a broken configuration ship.
 */
export function failsReleaseReadiness(decision: OutboundDecision): boolean {
  return decision.kind === 'BLOCK_UNSAFE_CONFIGURATION';
}

/**
 * The default flag snapshot: everything closed.
 *
 * Used when a value is absent. An unset flag must never read as permission — the
 * previous `=== 'true'` checks got this right individually, and centralising it means a
 * new flag cannot be added with the opposite default by accident.
 */
export function readFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === null || value.trim() === '') return defaultValue;
  return value.trim().toLowerCase() === 'true';
}
