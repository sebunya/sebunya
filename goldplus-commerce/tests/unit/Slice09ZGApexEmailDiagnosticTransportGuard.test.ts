import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InternalEmailDiagnosticCanaryGuard,
  type InternalEmailDiagnosticCanaryInput,
} from '../../apps/api/src/application/services/consent/InternalEmailDiagnosticCanaryGuard';
import { fingerprintInternalCanaryRecipient } from '../../apps/api/src/application/services/consent/InternalConsentCanaryGuard';
import {
  classifyTransactionalEmailFailure,
  redactTransactionalEmailProviderCode,
} from '../../apps/api/src/application/services/consent/TransactionalEmailFailureForensics';
import { ZeptoInternalConsentCanaryTransport } from '../../apps/api/src/infrastructure/consent/ZeptoInternalConsentCanaryTransport';

const root = resolve(import.meta.dirname, '../..');
const recipient = 'internal-diagnostic@example.com';
const ready = (): InternalEmailDiagnosticCanaryInput => ({
  transport_response_capture_implemented: true,
  internal_canary: true,
  provider: 'transactional_email',
  recipient,
  recipient_hash: fingerprintInternalCanaryRecipient(recipient),
  recipient_classification: 'robert_owned_internal_test',
  recipient_allowlisted: true,
  recipient_count: 1,
  correlation_id: 'slice-09-zg-diagnostic-test',
  max_attempts_for_run: 1,
  audit_event_recorded: true,
  eligibility_passed: true,
  suppression_checked_and_clear: true,
  withdrawal_checked_and_clear: true,
  policy_checked_and_clear: true,
  copy_version_present: true,
  credential_present: true,
  sender_present: true,
  host_present: true,
  payload_valid: true,
  audit_event_table_available: true,
  provider_specific_diagnostic_mode: true,
  broad_live_send_gate_enabled: false,
  campaign_id: null,
  newsletter_id: null,
});

describe('internal email diagnostic canary guard', () => {
  it('authorizes one completely guarded internal email diagnostic', () => {
    expect(new InternalEmailDiagnosticCanaryGuard().authorize(ready()).ok).toBe(true);
  });

  const booleanFailures: Array<keyof InternalEmailDiagnosticCanaryInput> = [
    'transport_response_capture_implemented', 'internal_canary', 'recipient_allowlisted',
    'audit_event_recorded', 'eligibility_passed', 'suppression_checked_and_clear',
    'withdrawal_checked_and_clear', 'policy_checked_and_clear', 'copy_version_present',
    'credential_present', 'sender_present', 'host_present', 'payload_valid',
    'audit_event_table_available', 'provider_specific_diagnostic_mode',
  ];
  it.each(booleanFailures)('rejects when required check %s is false', field => {
    const input = ready();
    (input[field] as boolean) = false;
    expect(new InternalEmailDiagnosticCanaryGuard().authorize(input).ok).toBe(false);
  });

  const forbiddenRecipients = [
    'customer', 'prospect', 'checkout_contact', 'order_contact', 'support_contact',
    'legacy_preference_contact', 'unknown',
  ] as const;
  it.each(forbiddenRecipients)('rejects %s recipient classification', recipientClassification => {
    const input = ready();
    input.recipient_classification = recipientClassification;
    expect(new InternalEmailDiagnosticCanaryGuard().authorize(input).ok).toBe(false);
  });

  it.each([0, 2, 3, 10, 100])('rejects recipient count %i', recipientCount => {
    const input = ready();
    input.recipient_count = recipientCount;
    expect(new InternalEmailDiagnosticCanaryGuard().authorize(input).ok).toBe(false);
  });

  it.each([0, 2, 3, 5, 99])('rejects max attempts %i', maxAttempts => {
    const input = ready();
    input.max_attempts_for_run = maxAttempts;
    expect(new InternalEmailDiagnosticCanaryGuard().authorize(input).ok).toBe(false);
  });

  it.each(['', ' ', '\n', '\t'])('rejects blank correlation id %#', correlation => {
    const input = ready();
    input.correlation_id = correlation;
    expect(new InternalEmailDiagnosticCanaryGuard().authorize(input).ok).toBe(false);
  });

  it('rejects an unbound recipient hash', () => {
    const input = ready();
    input.recipient_hash = 'a'.repeat(64);
    expect(new InternalEmailDiagnosticCanaryGuard().authorize(input)).toMatchObject({
      ok: false, reasons: expect.arrayContaining(['recipient_hash_binding_required']),
    });
  });

  it('rejects the broad live-send gate', () => {
    const input = ready();
    input.broad_live_send_gate_enabled = true;
    expect(new InternalEmailDiagnosticCanaryGuard().authorize(input).ok).toBe(false);
  });

  it.each(['campaign-1', 'bulk-1', 'marketing-1'])('rejects campaign identifier %s', campaignId => {
    const input = ready();
    input.campaign_id = campaignId;
    expect(new InternalEmailDiagnosticCanaryGuard().authorize(input).ok).toBe(false);
  });

  it.each(['newsletter-1', 'broadcast-1', 'audience-1'])('rejects newsletter identifier %s', newsletterId => {
    const input = ready();
    input.newsletter_id = newsletterId;
    expect(new InternalEmailDiagnosticCanaryGuard().authorize(input).ok).toBe(false);
  });

  it('enforces one attempt per guard instance', () => {
    const guard = new InternalEmailDiagnosticCanaryGuard();
    expect(guard.authorize(ready()).ok).toBe(true);
    expect(guard.authorize(ready())).toMatchObject({
      ok: false, reasons: expect.arrayContaining(['max_one_canary_per_provider_per_run']),
    });
    expect(guard.attemptCount()).toBe(1);
  });

  it('locks down after the run', () => {
    const guard = new InternalEmailDiagnosticCanaryGuard();
    guard.lockDown();
    expect(guard.isLockedDown()).toBe(true);
    expect(guard.authorize(ready()).ok).toBe(false);
  });
});

describe('redacted diagnostic response classification', () => {
  const cases = [
    [400, 'invalid request payload', 'payload_validation'],
    [401, 'private', 'unauthorized'],
    [403, 'sender forbidden', 'forbidden_sender'],
    [422, 'recipient rejected', 'recipient_rejected'],
    [429, 'rate limit', 'rate_limited'],
    [500, 'private', 'provider_5xx'],
    [502, 'private', 'provider_5xx'],
    [503, 'private', 'provider_5xx'],
  ] as const;
  it.each(cases)('classifies HTTP %i as %s', (status, code, expected) => {
    expect(classifyTransactionalEmailFailure({ response_status: status, provider_code: code }).classification)
      .toBe(expected);
  });

  const safeCodes = ['TM_101', 'INVALID_TOKEN', 'RATE.LIMIT', 'SENDER-FORBIDDEN', 'E123'];
  it.each(safeCodes)('preserves a stable redacted reference for bounded provider code %s', code => {
    expect(redactTransactionalEmailProviderCode(code)).toMatch(/^code_[a-f0-9]{12}$/);
    expect(redactTransactionalEmailProviderCode(code)).not.toContain(code);
  });

  const unsafeCodes = [
    'recipient@example.com', 'Bearer private', 'Zoho-enczapikey private', 'code with spaces',
    '<html>private</html>', 'x'.repeat(65), '', 'line\nbreak', 'tab\tvalue', 'a/b', 'a?b', 'a=b',
  ];
  it.each(unsafeCodes)('drops unsafe provider value %#', code => {
    expect(redactTransactionalEmailProviderCode(code)).toBeNull();
  });

  const opaqueValues = Array.from({ length: 40 }, (_, index) => `private-${index}@example.com`);
  it.each(opaqueValues)('never returns opaque value %# from classifier', value => {
    expect(JSON.stringify(classifyTransactionalEmailFailure({ provider_code: value }))).not.toContain(value);
  });
});

describe('diagnostic transport capture', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    vi.unstubAllGlobals();
  });

  function authorization() {
    const result = new InternalEmailDiagnosticCanaryGuard().authorize(ready());
    if (!result.ok) throw new Error('expected authorization');
    return result.authorization;
  }

  async function response(status: number, body: unknown) {
    process.env.CONSENT_INTERNAL_CANARY_EMAIL_ENABLED = 'true';
    process.env.NOTIFICATIONS_LIVE_SEND_ENABLED = 'false';
    process.env.ZEPTOMAIL_API_TOKEN = 'never-output-this-token';
    process.env.ZEPTOMAIL_FROM_ADDRESS = 'sender@example.com';
    process.env.ZEPTOMAIL_BASE_URL = 'https://provider.invalid/email';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json' },
    })));
    return new ZeptoInternalConsentCanaryTransport().send(authorization(), recipient);
  }

  it.each([
    [400, { error: { code: 'VALIDATION_ERROR' } }, 'payload_validation'],
    [401, { error: { code: 'AUTH_101' } }, 'unauthorized'],
    [403, { error: { message: 'sender forbidden' } }, 'forbidden_sender'],
    [422, { error: { message: 'recipient rejected' } }, 'recipient_rejected'],
    [429, { error: { code: 'RATE_LIMIT' } }, 'rate_limited'],
  ] as const)('captures HTTP %i with category %s', async (status, body, expected) => {
    const result = await response(status, body);
    expect(result).toMatchObject({
      status: 'failed', http_status: status, provider_status: 'failed',
      provider_error_category: expected, response_received: true, network_error: false, timeout: false,
    });
    expect(JSON.stringify(result)).not.toContain('never-output-this-token');
    expect(JSON.stringify(result)).not.toContain(recipient);
  });

  it('captures a successful provider response and hashes the message id', async () => {
    const result = await response(200, { data: [{ message_id: 'private-provider-message-id' }] });
    expect(result).toMatchObject({
      status: 'sent', http_status: 200, provider_status: 'accepted', response_received: true,
      provider_error_category: null, retryable: false,
    });
    expect(result.provider_reference_hash).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(result)).not.toContain('private-provider-message-id');
  });

  it('captures an unknown success-status failure shape without leaking it', async () => {
    const result = await response(200, { status: 'failure', error: { message: 'opaque private failure' } });
    expect(result).toMatchObject({
      status: 'failed', http_status: 200, provider_error_category: 'unknown', response_received: true,
    });
    expect(JSON.stringify(result)).not.toContain('opaque private failure');
  });

  it('uses fixed diagnostic copy with no campaign metadata', async () => {
    await response(200, { message: 'success' });
    const fetchMock = vi.mocked(globalThis.fetch);
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.textbody).toBe('GoldPlus internal consent delivery diagnostic canary. No customer action required.');
    expect(request).not.toHaveProperty('campaign_id');
    expect(request).not.toHaveProperty('newsletter_id');
    expect(request.track_clicks).toBe(false);
    expect(request.track_opens).toBe(false);
  });
});

describe('Slice 9-ZG red-line scope', () => {
  const sourceFiles = [
    'apps/api/src/application/services/consent/InternalEmailDiagnosticCanaryGuard.ts',
    'apps/api/src/application/services/consent/TransactionalEmailFailureForensics.ts',
    'apps/api/src/infrastructure/consent/ZeptoInternalConsentCanaryTransport.ts',
  ];
  const source = () => sourceFiles.map(file => readFileSync(resolve(root, file), 'utf8')).join('\n');
  it.each(sourceFiles)('%s has no production env-file or private key', file => {
    expect(readFileSync(resolve(root, file), 'utf8')).not.toMatch(/\.env\.production|PRIVATE KEY/);
  });
  it.each([
    'sendSms', 'sendWhatsApp', 'dispatchCampaign', 'bulkSend', 'newsletterSend', 'processOutbox',
    'PesaPal', 'checkoutMutation', 'orderMutation', 'rewriteRbac', 'loyaltyLedger',
    'activateMemoryLane', 'issueReward', 'issueCoupon', 'activatePersonalisation',
  ])('does not implement forbidden capability %s', forbidden => {
    expect(source()).not.toContain(forbidden);
  });
  it.each(Array.from({ length: 35 }, (_, index) => `customer-${index}@example.com`))(
    'never embeds synthetic customer target %#', target => expect(source()).not.toContain(target),
  );
});
