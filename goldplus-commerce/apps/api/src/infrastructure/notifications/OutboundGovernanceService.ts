import {
  MessageClass,
  OutboundChannel,
  OutboundContext,
  OutboundDecision,
  OutboundFlags,
  RecipientClass,
  decideOutbound,
  failsReleaseReadiness,
  readFlag,
} from '../../domain/notifications/OutboundGovernancePolicy';
import { logger } from '../logging/logger';

/**
 * The single place the outbound flags are read.
 *
 * Every provider previously read them itself, with `=== 'true'` repeated per adapter and
 * per flag. Individually correct; collectively, three sources of truth that disagreed
 * about which flags mattered and in what order. Two of them — PROVIDER_DELIVERY_ENABLED
 * and CUSTOMER_COMMUNICATIONS_ENABLED — were read by no adapter at all and enforced only
 * by convention.
 *
 * The decision itself is pure and lives in the domain. This layer's whole job is to turn
 * the environment and the message into the snapshot that function takes.
 */

const CHANNEL_FLAG: Record<OutboundChannel, string> = {
  EMAIL: 'NOTIFICATIONS_EMAIL_ENABLED',
  SMS: 'NOTIFICATIONS_SMS_ENABLED',
  WHATSAPP: 'NOTIFICATIONS_WHATSAPP_ENABLED',
  PUSH: 'NOTIFICATIONS_PUSH_ENABLED',
};

export interface OutboundRequest {
  channel: OutboundChannel;
  messageClass: MessageClass;
  recipientClass: RecipientClass;
  providerConfigured: boolean;
  serviceHealthy?: boolean;
  allowlistActive: boolean;
  recipientAllowlisted: boolean;
  consentGranted?: boolean;
  suppressed?: boolean;
  frequencyCapReached?: boolean;
  /** For the audit line. Must already be masked by the caller. */
  maskedRecipient?: string;
}

export class OutboundGovernanceService {
  /**
   * Reads the flags.
   *
   * `dryRun` defaults to TRUE when unset, unlike every other flag. An absent dry-run
   * setting must mean "simulate", not "send": the safe reading of silence is the one
   * that does not contact a customer. Every other flag defaults to false for the same
   * reason — silence must never read as permission.
   */
  flags(channel: OutboundChannel, env: NodeJS.ProcessEnv = process.env): OutboundFlags {
    return {
      providerDeliveryEnabled: readFlag(env.PROVIDER_DELIVERY_ENABLED),
      customerCommunicationsEnabled: readFlag(env.CUSTOMER_COMMUNICATIONS_ENABLED),
      notificationDeliveryEnabled: readFlag(env.NOTIFICATION_DELIVERY_ENABLED),
      liveSendEnabled: readFlag(env.NOTIFICATIONS_LIVE_SEND_ENABLED),
      channelEnabled: readFlag(env[CHANNEL_FLAG[channel]]),
      dryRun: readFlag(env.NOTIFICATIONS_DRY_RUN, true),
      operatorApproved: readFlag(env.NOTIFICATIONS_OPERATOR_APPROVED),
    };
  }

  /**
   * Decides, and records the decision.
   *
   * Every decision is logged with its guard, because the reason a message did not go out
   * is operational information that the message itself cannot carry — and the previous
   * design left it in a provider-specific message string that nothing could group by.
   * An unsafe configuration is logged at error level: it must fail release readiness,
   * so it needs to be visible without anyone looking for it.
   */
  decide(request: OutboundRequest, env: NodeJS.ProcessEnv = process.env): OutboundDecision {
    const flags = this.flags(request.channel, env);

    const context: OutboundContext = {
      channel: request.channel,
      messageClass: request.messageClass,
      recipientClass: request.recipientClass,
      providerConfigured: request.providerConfigured,
      serviceHealthy: request.serviceHealthy ?? true,
      allowlistActive: request.allowlistActive,
      recipientAllowlisted: request.recipientAllowlisted,
      // Consent, when the caller knows it. When it does not, the fallback is derived
      // from the message class rather than assumed either way:
      //
      //   MARKETING            -> blocked. Marketing to someone whose consent nobody
      //                           recorded is precisely the failure consent exists to
      //                           prevent, and there is no lawful basis to infer it.
      //   TRANSACTIONAL        -> permitted. An order confirmation to the customer who
      //                           just placed that order has its basis in the
      //                           transaction, not in a marketing opt-in.
      //   OPERATIONAL          -> permitted. Internal staff, governed by employment.
      //
      // Stated plainly because it IS a policy choice: this platform has no consent
      // repository wired yet. Defaulting every customer to "no consent" would block
      // every order confirmation — a functional break dressed as safety — and defaulting
      // to "granted" would be fake safety. When a consent source exists, callers pass
      // `consentGranted` and this fallback stops being reached.
      consentGranted:
        request.consentGranted ?? request.messageClass !== 'MARKETING',
      suppressed: request.suppressed ?? false,
      frequencyCapReached: request.frequencyCapReached ?? false,
    };

    const decision = decideOutbound(flags, context);

    const line = {
      channel: request.channel,
      messageClass: request.messageClass,
      recipientClass: request.recipientClass,
      decision: decision.kind,
      guard: decision.guard,
      // Masked by the caller. A raw recipient in a log line is customer data in a store
      // retained far longer than the request.
      recipient: request.maskedRecipient,
    };

    if (failsReleaseReadiness(decision)) {
      logger.error(line, 'OUTBOUND_UNSAFE_CONFIGURATION');
    } else if (decision.kind === 'ALLOW_LIVE') {
      logger.info(line, 'OUTBOUND_LIVE_PERMITTED');
    } else {
      logger.info(line, 'OUTBOUND_DECISION');
    }

    return decision;
  }

  /**
   * The configuration verdict for a readiness check, independent of any message.
   *
   * Uses a deliberately permissive context — everything the message could contribute is
   * satisfied — so the only thing that can produce a block is the FLAGS. A readiness
   * check must report on the deployment, not on whichever recipient happened to be
   * examined.
   */
  configurationVerdict(
    channel: OutboundChannel,
    providerConfigured: boolean,
    env: NodeJS.ProcessEnv = process.env,
  ): OutboundDecision {
    return decideOutbound(this.flags(channel, env), {
      channel,
      messageClass: 'OPERATIONAL',
      recipientClass: 'INTERNAL',
      providerConfigured,
      serviceHealthy: true,
      allowlistActive: false,
      recipientAllowlisted: true,
      consentGranted: true,
      suppressed: false,
      frequencyCapReached: false,
    });
  }
}

export const outboundGovernance = new OutboundGovernanceService();
