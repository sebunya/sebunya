import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TRANSACTIONAL_EMAIL_FAILURE_CLASSIFICATIONS,
  assessEmailCanaryRerunReadiness,
  classifyTransactionalEmailFailure,
  type EmailCanaryRerunReadiness,
  type TransactionalEmailFailureEvidence,
} from '../../apps/api/src/application/services/consent/TransactionalEmailFailureForensics';
import { InternalConsentCanaryGuard } from '../../apps/api/src/application/services/consent/InternalConsentCanaryGuard';
import { ZeptoInternalConsentCanaryTransport } from '../../apps/api/src/infrastructure/consent/ZeptoInternalConsentCanaryTransport';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const readiness = (): EmailCanaryRerunReadiness => ({
  previous_failure_classified: true,
  remediation_verified: true,
  internal_recipient_allowlisted: true,
  credential_present: true,
  sender_present: true,
  host_present: true,
  payload_valid: true,
  suppression_clear: true,
  withdrawal_clear: true,
  policy_clear: true,
  copy_version_present: true,
  audit_available: true,
  internal_canary_gate_only: true,
  max_attempts_one: true,
  broad_live_send_disabled: true,
});

describe('redacted failure classification', () => {
  const cases: Array<[TransactionalEmailFailureEvidence, string]> = [
    [{ missing_configuration: true }, 'missing_configuration'],
    [{ provider_code: 'invalid credential token' }, 'invalid_credential'],
    [{ response_status: 401 }, 'unauthorized'],
    [{ provider_code: 'sender is forbidden' }, 'forbidden_sender'],
    [{ provider_code: 'domain not verified' }, 'domain_not_verified'],
    [{ provider_code: 'recipient rejected' }, 'recipient_rejected'],
    [{ response_status: 400 }, 'payload_validation'],
    [{ response_status: 422 }, 'payload_validation'],
    [{ provider_code: 'template not found' }, 'template_missing'],
    [{ response_status: 429 }, 'rate_limited'],
    [{ response_status: 500 }, 'provider_5xx'],
    [{ response_status: 503 }, 'provider_5xx'],
    [{ timed_out: true }, 'network_timeout'],
    [{ adapter_bug_confirmed: true }, 'transport_adapter_bug'],
    [{}, 'unknown'],
  ];
  it.each(cases)('classifies %# without raw provider details', (input, expected) => {
    expect(classifyTransactionalEmailFailure(input).classification).toBe(expected);
  });

  const statuses = [400, 401, 403, 404, 409, 422, 429, 499, 500, 501, 502, 503, 504, 599];
  it.each(statuses)('maps HTTP %i to a category without returning the status', status => {
    const result = classifyTransactionalEmailFailure({ response_status: status });
    expect(JSON.stringify(result)).not.toContain(String(status));
    expect(result.provider_status_category).toMatch(/^http_(4xx|5xx)$/);
  });

  const sensitiveCodes = Array.from({ length: 32 }, (_, index) => `private-token-${index}-recipient@example.com`);
  it.each(sensitiveCodes)('never returns raw provider value %#', providerCode => {
    const result = classifyTransactionalEmailFailure({ provider_code: providerCode });
    expect(JSON.stringify(result)).not.toContain(providerCode);
    expect(result.provider_code_category).toBe('unavailable');
  });

  it.each(TRANSACTIONAL_EMAIL_FAILURE_CLASSIFICATIONS)('returns a bounded record for %s taxonomy coverage', classification => {
    const result = classifyTransactionalEmailFailure({ provider_code: classification.replaceAll('_', ' ') });
    expect(Object.keys(result).sort()).toEqual([
      'classification', 'provider_code_category', 'provider_status_category', 'requires_provider_action',
      'retryable', 'safe_local_fix_available',
    ]);
  });
});

describe('rerun readiness is fail-closed', () => {
  it('permits only a completely ready rerun', () => {
    expect(assessEmailCanaryRerunReadiness(readiness())).toEqual({ permitted: true, blockers: [] });
  });

  const fields = Object.keys(readiness()) as Array<keyof EmailCanaryRerunReadiness>;
  it.each(fields)('blocks when %s is false', field => {
    const input = readiness();
    input[field] = false;
    expect(assessEmailCanaryRerunReadiness(input)).toEqual({ permitted: false, blockers: [field] });
  });

  const blockerPairs = Array.from({ length: 30 }, (_, index) => [
    fields[index % fields.length],
    fields[(index + 1 + Math.floor(index / fields.length)) % fields.length],
  ] as const);
  it.each(blockerPairs)('reports both blockers for %s and %s', (first, second) => {
    const input = readiness();
    input[first] = false;
    input[second] = false;
    const result = assessEmailCanaryRerunReadiness(input);
    expect(result.permitted).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([first, second]));
  });
});

describe('transport retains redacted future diagnostics', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    vi.unstubAllGlobals();
  });

  function authorization() {
    const guard = new InternalConsentCanaryGuard();
    const result = guard.authorize({
      internal_canary: true,
      provider: 'transactional_email',
      recipient: 'internal-canary@example.com',
      recipient_classification: 'provider_sandbox',
      recipient_allowlisted: true,
      recipient_count: 1,
      correlation_id: 'slice-09-zf-test',
      audit_event_recorded: true,
      eligibility_passed: true,
      suppression_check_passed: true,
      withdrawal_check_passed: true,
      policy_block_check_passed: true,
      copy_template_version_present: true,
      provider_credential_present: true,
      provider_specific_canary_mode: true,
      broad_live_send_gate_enabled: false,
      campaign_id: null,
      newsletter_id: null,
    });
    if (!result.ok) throw new Error('authorization expected');
    return result.authorization;
  }

  async function failedResponse(status: number, error: unknown) {
    process.env.CONSENT_INTERNAL_CANARY_EMAIL_ENABLED = 'true';
    process.env.NOTIFICATIONS_LIVE_SEND_ENABLED = 'false';
    process.env.ZEPTOMAIL_API_TOKEN = 'never-return-this-token';
    process.env.ZEPTOMAIL_FROM_ADDRESS = 'sender@example.com';
    process.env.ZEPTOMAIL_BASE_URL = 'https://provider.invalid/email';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error }), {
      status, headers: { 'Content-Type': 'application/json' },
    })));
    return new ZeptoInternalConsentCanaryTransport().send(authorization(), 'internal-canary@example.com');
  }

  it.each([
    [400, { code: 'VALIDATION_ERROR' }, 'payload_validation'],
    [401, { code: 'PRIVATE-CODE' }, 'unauthorized'],
    [403, { message: 'sender forbidden' }, 'forbidden_sender'],
    [422, { message: 'recipient rejected' }, 'recipient_rejected'],
    [429, { code: 'RATE_LIMIT' }, 'rate_limited'],
  ] as const)('classifies HTTP %i as %s without response leakage', async (status, error, expected) => {
    const result = await failedResponse(status, error);
    expect(result.failure?.classification).toBe(expected);
    expect(JSON.stringify(result)).not.toContain('never-return-this-token');
    expect(JSON.stringify(result)).not.toContain('PRIVATE-CODE');
  });

  it('classifies a missing configuration without calling fetch', async () => {
    process.env.CONSENT_INTERNAL_CANARY_EMAIL_ENABLED = 'true';
    process.env.NOTIFICATIONS_LIVE_SEND_ENABLED = 'false';
    delete process.env.ZEPTOMAIL_API_TOKEN;
    delete process.env.ZEPTOMAIL_FROM_ADDRESS;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await new ZeptoInternalConsentCanaryTransport().send(authorization(), 'internal-canary@example.com');
    expect(result.failure?.classification).toBe('missing_configuration');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Slice 9-ZF scope and red lines', () => {
  const files = [
    'apps/api/src/application/services/consent/TransactionalEmailFailureForensics.ts',
    'apps/api/src/infrastructure/consent/ZeptoInternalConsentCanaryTransport.ts',
  ];
  it.each(files)('%s contains no secret literal or env-file access', file => {
    const source = read(file);
    expect(source).not.toMatch(/\.env\.production|BEGIN (RSA|OPENSSH) PRIVATE KEY/);
  });
  it.each([
    'dispatchCampaign', 'sendSms', 'sendWhatsApp', 'PesaPal', 'checkoutMutation', 'rewriteRbac',
    'loyaltyLedger', 'activateMemoryLane', 'issueReward', 'issueCoupon', 'bulkSend', 'newsletterSend',
  ])('does not activate forbidden capability %s', forbidden => {
    expect(files.map(read).join('\n')).not.toContain(forbidden);
  });
});
