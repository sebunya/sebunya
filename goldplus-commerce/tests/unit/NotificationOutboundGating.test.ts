import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decideOutbound,
  failsReleaseReadiness,
  permitsNetworkCall,
  readFlag,
  type OutboundContext,
  type OutboundFlags,
} from '../../apps/api/src/domain/notifications/OutboundGovernancePolicy';
import { classifyTemplate } from '../../apps/api/src/infrastructure/notifications/messageClassification';

/**
 * Outbound customer communication is the least reversible thing this platform can do. A
 * message sent to a real customer cannot be recalled.
 *
 * Each provider used to interpret the environment flags itself. The gates were
 * individually defensible, but they were not the same gates and they did not agree:
 *
 *   - a dry run reported `status: 'SENT'` in BOTH adapters, so a suppressed message was
 *     indistinguishable from a delivered one in every metric and query
 *   - the allowlist came before dry-run in SMS and after credentials in email, so one
 *     environment refused different messages depending on which channel carried them
 *   - PROVIDER_DELIVERY_ENABLED and CUSTOMER_COMMUNICATIONS_ENABLED were read by NEITHER
 *     adapter and enforced only by convention
 *
 * The decision now lives in one pure function, so it is tested exhaustively here without
 * an environment, a provider or a network — which is also why these are behavioural
 * assertions rather than the source-text checks this file used to hold.
 */

const LOCKED: OutboundFlags = {
  providerDeliveryEnabled: false,
  customerCommunicationsEnabled: false,
  notificationDeliveryEnabled: false,
  liveSendEnabled: false,
  channelEnabled: false,
  dryRun: true,
  operatorApproved: false,
};

/** Everything a live send needs, and nothing contradictory. */
const OPEN: OutboundFlags = {
  providerDeliveryEnabled: true,
  customerCommunicationsEnabled: true,
  notificationDeliveryEnabled: true,
  liveSendEnabled: true,
  channelEnabled: true,
  dryRun: false,
  operatorApproved: true,
};

const CONTEXT: OutboundContext = {
  channel: 'EMAIL',
  messageClass: 'TRANSACTIONAL',
  recipientClass: 'CUSTOMER',
  providerConfigured: true,
  serviceHealthy: true,
  allowlistActive: false,
  recipientAllowlisted: true,
  consentGranted: true,
  suppressed: false,
  frequencyCapReached: false,
};

const decide = (flags: Partial<OutboundFlags> = {}, context: Partial<OutboundContext> = {}) =>
  decideOutbound({ ...OPEN, ...flags }, { ...CONTEXT, ...context });

describe('a locked-down system sends nothing', () => {
  it('blocks on the master switch', () => {
    const decision = decideOutbound(LOCKED, CONTEXT);
    expect(decision.kind).toBe('BLOCK_GLOBAL_DISABLED');
    expect(decision.guard).toBe('PROVIDER_DELIVERY_ENABLED');
    expect(permitsNetworkCall(decision)).toBe(false);
  });

  it('never permits a network call for any block', () => {
    for (const flags of [
      { providerDeliveryEnabled: false },
      { notificationDeliveryEnabled: false },
      { customerCommunicationsEnabled: false },
      { channelEnabled: false },
      { liveSendEnabled: false },
      { operatorApproved: false },
    ]) {
      expect(permitsNetworkCall(decide(flags)), JSON.stringify(flags)).toBe(false);
    }
  });

  it('treats an absent or unrecognised flag as closed, never as permission', () => {
    expect(readFlag(undefined)).toBe(false);
    expect(readFlag('')).toBe(false);
    expect(readFlag('TRUE')).toBe(true);
    // "1" and "yes" look like enablement to a human and are not accepted, so a typo in a
    // deployment cannot silently unlock outbound delivery.
    expect(readFlag('1')).toBe(false);
    expect(readFlag('yes')).toBe(false);
  });

  it('treats an absent dry-run setting as SIMULATE, not send', () => {
    // The safe reading of silence is the one that does not contact a customer.
    expect(readFlag(undefined, true)).toBe(true);
  });
});

describe('the guards are evaluated most-global first', () => {
  it('reports the master switch even when narrower guards are also closed', () => {
    // A stable reason matters: otherwise the reported cause changes depending on which
    // narrower guard happened to be checked first.
    // Customer communications are turned off too, because leaving them ON while the
    // master switch is OFF is itself refused as contradictory — which is a separate
    // guard, proven below.
    expect(
      decide({
        providerDeliveryEnabled: false,
        customerCommunicationsEnabled: false,
        channelEnabled: false,
      }).guard,
    ).toBe('PROVIDER_DELIVERY_ENABLED');
  });

  it('reports the notification subsystem before the channel', () => {
    expect(decide({ notificationDeliveryEnabled: false, channelEnabled: false }).guard)
      .toBe('NOTIFICATION_DELIVERY_ENABLED');
  });

  it('does not examine consent for a globally blocked message', () => {
    // Reading customer data to answer a question already settled.
    expect(
      decide(
        { providerDeliveryEnabled: false, customerCommunicationsEnabled: false },
        { consentGranted: false },
      ).kind,
    ).toBe('BLOCK_GLOBAL_DISABLED');
  });

  it('reports an unconfigured provider before a recipient rule', () => {
    expect(decide({}, { providerConfigured: false, suppressed: true }).kind)
      .toBe('BLOCK_PROVIDER_NOT_CONFIGURED');
  });

  it('reports a degraded service rather than attempting the call', () => {
    expect(decide({}, { serviceHealthy: false }).kind).toBe('BLOCK_SERVICE_UNHEALTHY');
  });
});

describe('operational and customer messages are governed separately', () => {
  it('lets an operational message through with customer communications disabled', () => {
    // That is the whole reason the two flags exist. Blocking staff alerts alongside
    // customer email is how operators lose visibility during a lockdown.
    expect(
      decide(
        { customerCommunicationsEnabled: false },
        { messageClass: 'OPERATIONAL', recipientClass: 'INTERNAL' },
      ).kind,
    ).toBe('ALLOW_LIVE');
  });

  it('blocks a transactional customer message with customer communications disabled', () => {
    const decision = decide({ customerCommunicationsEnabled: false });
    expect(decision.kind).toBe('BLOCK_GLOBAL_DISABLED');
    expect(decision.guard).toBe('CUSTOMER_COMMUNICATIONS_ENABLED');
  });

  it('blocks marketing with customer communications disabled', () => {
    expect(decide({ customerCommunicationsEnabled: false }, { messageClass: 'MARKETING' }).kind)
      .toBe('BLOCK_GLOBAL_DISABLED');
  });
});

describe('recipient rules are ordered by what outranks what', () => {
  it('suppression outranks consent', () => {
    // Someone who asked not to be contacted must not be reachable because a consent
    // record says otherwise.
    expect(decide({}, { suppressed: true, consentGranted: true }).kind).toBe('BLOCK_SUPPRESSION');
  });

  it('blocks a customer with no consent, and names the class', () => {
    const decision = decide({}, { consentGranted: false });
    expect(decision.kind).toBe('BLOCK_CONSENT');
    expect(decision.guard).toContain('TRANSACTIONAL');
  });

  it('does not apply consent to internal staff', () => {
    // Governed by employment, not by a marketing opt-in.
    expect(
      decide({}, { recipientClass: 'INTERNAL', messageClass: 'OPERATIONAL', consentGranted: false })
        .kind,
    ).toBe('ALLOW_LIVE');
  });

  it('reports consent before frequency, so a consent failure is not read as volume', () => {
    expect(decide({}, { consentGranted: false, frequencyCapReached: true }).kind)
      .toBe('BLOCK_CONSENT');
  });

  it('blocks on the frequency cap once consent is satisfied', () => {
    expect(decide({}, { frequencyCapReached: true }).kind).toBe('BLOCK_FREQUENCY_CAP');
  });
});

describe('an active allowlist is containment, not a downgrade', () => {
  it('blocks a recipient not on the list outright', () => {
    // Quietly downgrading to a dry run would look like a successful send in the record.
    const decision = decide({}, { allowlistActive: true, recipientAllowlisted: false });
    expect(decision.kind).toBe('BLOCK_RECIPIENT_NOT_ALLOWLISTED');
    expect(decision.guard).toBe('NOTIFICATIONS_ALLOWED_TEST_RECIPIENTS');
  });

  it('permits a listed recipient', () => {
    expect(decide({}, { allowlistActive: true, recipientAllowlisted: true }).kind)
      .toBe('ALLOW_LIVE');
  });

  it('ignores the list when none is configured', () => {
    expect(decide({}, { allowlistActive: false, recipientAllowlisted: false }).kind)
      .toBe('ALLOW_LIVE');
  });
});

describe('a dry run is a simulation, never a success', () => {
  it('permits simulation but no network call', () => {
    const decision = decide({ dryRun: true, liveSendEnabled: false });
    expect(decision.kind).toBe('ALLOW_DRY_RUN');
    // The distinction that was missing: both adapters returned SENT for a dry run.
    expect(permitsNetworkCall(decision)).toBe(false);
    expect(decision.live).toBe(false);
  });

  it('refuses dry-run and live-send together as contradictory', () => {
    // Resolving it silently either way risks sending real messages to someone who
    // believed they were simulating.
    const decision = decide({ dryRun: true, liveSendEnabled: true });
    expect(decision.kind).toBe('BLOCK_UNSAFE_CONFIGURATION');
    expect(decision.guard).toBe('DRY_RUN_AND_LIVE_SEND_BOTH_ENABLED');
  });
});

describe('an unsafe configuration blocks and fails release readiness', () => {
  it('fails readiness for a contradictory configuration', () => {
    expect(failsReleaseReadiness(decide({ dryRun: true, liveSendEnabled: true }))).toBe(true);
  });

  it('refuses customer communications granted while provider delivery is off', () => {
    const decision = decideOutbound({ ...LOCKED, customerCommunicationsEnabled: true }, CONTEXT);
    expect(decision.kind).toBe('BLOCK_UNSAFE_CONFIGURATION');
    expect(decision.guard).toBe('CUSTOMER_COMMUNICATIONS_WITHOUT_PROVIDER_DELIVERY');
  });

  it('does NOT fail readiness for an ordinary block', () => {
    // A customer withholding consent is the system working. Conflating the two would
    // either make consent failures block releases or let a broken configuration ship.
    expect(failsReleaseReadiness(decide({}, { consentGranted: false }))).toBe(false);
    expect(failsReleaseReadiness(decideOutbound(LOCKED, CONTEXT))).toBe(false);
  });

  it('names the failed guard as a code rather than describing it', () => {
    // The previous check buried exactly this in a prose message string, so nothing could
    // group by it. "Something is wrong" is not actionable at 3am.
    expect(decide({ dryRun: true, liveSendEnabled: true }).guard).toMatch(/^[A-Z][A-Z0-9_]+$/);
  });
});

describe('operator approval is the last gate, and it is its own reason', () => {
  it('blocks a fully-configured live send with no approval', () => {
    const decision = decide({ operatorApproved: false });
    expect(decision.kind).toBe('BLOCK_APPROVAL_REQUIRED');
    expect(decision.guard).toBe('NOTIFICATIONS_OPERATOR_APPROVED');
  });

  it('reports a missing approval as an approval problem, not an unsafe configuration', () => {
    // Nobody having approved live sending yet is a legitimate expected state. Reporting
    // it as unsafe would fail readiness for a correctly locked-down deployment and mask
    // whichever narrower guard was the real answer.
    expect(failsReleaseReadiness(decide({ operatorApproved: false }))).toBe(false);
  });

  it('permits a live send only when every guard is satisfied', () => {
    const decision = decide();
    expect(decision.kind).toBe('ALLOW_LIVE');
    expect(permitsNetworkCall(decision)).toBe(true);
  });
});

describe('message classification fails closed', () => {
  it('classifies an unknown template as the most restricted class', () => {
    // A new template added without being classified must not reach a customer by
    // default. Blocked and reported is recoverable; marketing to someone who never
    // consented is not.
    expect(classifyTemplate('SOME_NEW_TEMPLATE')).toBe('MARKETING');
    expect(classifyTemplate('')).toBe('MARKETING');
  });

  it('classifies the real operational templates', () => {
    expect(classifyTemplate('ADMIN_ORDER_EMAIL')).toBe('OPERATIONAL');
    expect(classifyTemplate('NEW_QUOTE_REQUEST')).toBe('OPERATIONAL');
  });

  it('classifies the real transactional templates', () => {
    for (const template of [
      'ORDER_RECEIVED_UNPAID',
      'ORDER_PAYMENT_SUCCESS',
      'ORDER_PAYMENT_FAILED',
      'PAYMENT_SUCCESS',
    ]) {
      expect(classifyTemplate(template), template).toBe('TRANSACTIONAL');
    }
  });

  it('is case-insensitive, so a mis-cased template is not silently blocked', () => {
    expect(classifyTemplate('order_payment_success')).toBe('TRANSACTIONAL');
  });
});

describe('both adapters delegate rather than deciding for themselves', () => {
  const email = readFileSync(
    join(__dirname, '../../apps/api/src/infrastructure/notifications/zeptomail/ZeptoMailAdapter.ts'),
    'utf8',
  );
  const sms = readFileSync(
    join(__dirname, '../../apps/api/src/infrastructure/notifications/sms/PahappaCommsSmsAdapter.ts'),
    'utf8',
  );

  describe.each([
    ['email', email],
    ['sms', sms],
  ])('%s', (_name, source) => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    it('asks the shared policy', () => {
      expect(code).toContain('outboundGovernance.decide(');
    });

    it('no longer reads the outbound flags itself', () => {
      // Three sources of truth that disagreed about which flags mattered and in what
      // order. One source now.
      for (const flag of [
        'NOTIFICATIONS_LIVE_SEND_ENABLED',
        'NOTIFICATIONS_DRY_RUN',
        'PROVIDER_DELIVERY_ENABLED',
        'CUSTOMER_COMMUNICATIONS_ENABLED',
      ]) {
        expect(code, flag).not.toContain(`process.env.${flag}`);
      }
    });

    it('decides before any network call', () => {
      const dispatch = code.slice(code.indexOf('async dispatch('));
      const decideAt = dispatch.indexOf('outboundGovernance.decide(');
      const fetchAt = dispatch.search(/await (resilientFetch|fetch)\(/);
      expect(decideAt).toBeGreaterThan(-1);
      expect(fetchAt).toBeGreaterThan(-1);
      expect(fetchAt).toBeGreaterThan(decideAt);
    });

    it('reports a simulation as DRY_RUN, never as SENT', () => {
      expect(code).toContain("status: 'DRY_RUN'");
      expect(code).not.toContain('DRY_RUN_SUCCESS');
    });

    it('returns the decision kind as the provider code', () => {
      // So a caller grouping by code sees WHY, not merely that something was blocked.
      expect(code).toContain('providerCode: decision.kind');
    });
  });
});

describe('the email preflight uses the same policy it reports on', () => {
  const email = readFileSync(
    join(__dirname, '../../apps/api/src/infrastructure/notifications/zeptomail/ZeptoMailAdapter.ts'),
    'utf8',
  );
  const preflight = email.slice(email.indexOf('async getBalance('));

  it('asks the policy rather than re-deriving the flags', () => {
    // It previously read them itself, so the check and the dispatch path could disagree
    // about whether the environment was safe.
    expect(preflight).toContain('configurationVerdict(');
  });

  it('reports FAIL, not WARN, for an unsafe configuration', () => {
    expect(preflight).toContain('failsReleaseReadiness(verdict)');
    expect(preflight).toContain("status: 'FAIL'");
  });

  it('declares FAIL in its own signature rather than smuggling it', () => {
    expect(email).toContain("'PASS' | 'WARN' | 'FAIL' | 'NOT_CONFIGURED'");
  });

  it('still reports PASS when the environment is genuinely locked down', () => {
    const tail = preflight.slice(preflight.lastIndexOf("status: 'PASS'"));
    expect(tail).toContain('Safe dry-run defaults are active');
  });
});

/* ── Account recovery is never marketing (2026-08-07) ────────────────────── */

describe('a password reset is transactional, and nobody consents to it', () => {
  it('classifies password_reset as TRANSACTIONAL, in either case', () => {
    // Production refused the first real reset with NO_CONSENT_FOR_MARKETING:
    // the template was unclassified, so the fail-closed default treated a
    // security message as an offer. A customer locked out of their account was
    // told a link was coming and never got one, because they had not opted in
    // to receiving marketing.
    expect(classifyTemplate('password_reset')).toBe('TRANSACTIONAL');
    expect(classifyTemplate('PASSWORD_RESET')).toBe('TRANSACTIONAL');
  });

  it('the fail-closed default is untouched — an unknown template is still MARKETING', () => {
    expect(classifyTemplate('SOME_TEMPLATE_NOBODY_CLASSIFIED')).toBe('MARKETING');
  });
});
