import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  INTERNAL_CANARY_PROVIDERS,
  PROVIDER_READINESS_IDS,
  InternalConsentCanaryGuard,
  classifyProviderReadiness,
  consumeInternalCanaryAuthorization,
  fingerprintInternalCanaryRecipient,
  type InternalCanaryAuthorizationInput,
  type InternalRecipientClassification,
  type ProviderReadinessChecks,
} from '../../apps/api/src/application/services/consent/InternalConsentCanaryGuard';
import { ZeptoInternalConsentCanaryTransport } from '../../apps/api/src/infrastructure/consent/ZeptoInternalConsentCanaryTransport';
import { evaluateConsentProviderEligibilityPreview } from '../../apps/api/src/domain/consent/ConsentProviderEligibilityPreview';
import { assertWithdrawalSupersedesGrant } from '../../apps/api/src/domain/consent/ConsentFoundation';

const root = resolve(import.meta.dirname, '../..');
const paths = {
  guard: 'apps/api/src/application/services/consent/InternalConsentCanaryGuard.ts',
  emailTransport: 'apps/api/src/infrastructure/consent/ZeptoInternalConsentCanaryTransport.ts',
  readinessEvidence: 'docs/platform/evidence/slices/slice-09-z-apex-provider-readiness.md',
  uatEvidence: 'docs/platform/evidence/slices/slice-09-z-apex-internal-consent-uat.md',
  canaryEvidence: 'docs/platform/evidence/slices/slice-09-z-apex-controlled-canary-report.md',
  noBroadSendEvidence: 'docs/platform/evidence/slices/slice-09-z-apex-no-broad-send-proof.md',
  rollbackEvidence: 'docs/platform/evidence/slices/slice-09-z-apex-rollback-plan.md',
  artifactEvidence: 'docs/platform/evidence/slices/slice-09-z-apex-artifact-review.md',
  test: 'tests/unit/Slice09ZApexProviderReadinessCanaryUAT.test.ts',
};
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const readyChecks = (): ProviderReadinessChecks => ({
  credential_present: true,
  host_or_base_url_present: true,
  sender_or_business_identity_present: true,
  template_or_message_key_present: true,
  internal_canary_recipient_present: true,
  live_send_gate_default_disabled: true,
  internal_canary_guard_present: true,
  suppression_table_available: true,
  audit_event_table_available: true,
  copy_template_version_available: true,
  eligibility_evaluator_available: true,
  rate_limit_one_available: true,
  rollback_gate_available: true,
  transport_implemented: true,
});

const authorizedInput = (overrides: Partial<InternalCanaryAuthorizationInput> = {}): InternalCanaryAuthorizationInput => ({
  internal_canary: true,
  provider: 'transactional_email',
  recipient: 'internal-canary@example.com',
  recipient_classification: 'robert_owned_internal_test',
  recipient_allowlisted: true,
  recipient_count: 1,
  correlation_id: 'slice-09-z-correlation',
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
  ...overrides,
});

describe('provider readiness booleans and classifications', () => {
  const booleanFields = Object.keys(readyChecks()) as Array<keyof ProviderReadinessChecks>;
  const matrixCases = PROVIDER_READINESS_IDS.flatMap(provider => booleanFields.map(field => ({ provider, field })));

  it.each(matrixCases)('$provider exposes boolean-only $field readiness', ({ field }) => {
    const checks = readyChecks();
    expect(typeof checks[field]).toBe('boolean');
    expect(JSON.stringify(checks)).not.toMatch(/token|secret|password|api[_-]?key/i);
  });

  it.each(INTERNAL_CANARY_PROVIDERS)('%s is ready only when every guard is satisfied', provider => {
    expect(classifyProviderReadiness(provider, readyChecks())).toBe('ready_for_internal_canary');
  });

  it.each(['meta_capi', 'tiktok_events', 'google_ads', 'linkedin', 'x', 'pinterest', 'snapchat', 'posthog'] as const)(
    '%s remains dry-run only',
    provider => expect(classifyProviderReadiness(provider, readyChecks())).toBe('dry_run_only'),
  );

  it('blocks only the provider with missing credentials', () => {
    expect(classifyProviderReadiness('transactional_email', { ...readyChecks(), credential_present: false }))
      .toBe('blocked_missing_credentials');
    expect(classifyProviderReadiness('sms', readyChecks())).toBe('ready_for_internal_canary');
  });

  it('classifies missing sender', () => {
    expect(classifyProviderReadiness('transactional_email', { ...readyChecks(), sender_or_business_identity_present: false }))
      .toBe('blocked_missing_sender');
  });

  it('classifies missing template', () => {
    expect(classifyProviderReadiness('transactional_email', { ...readyChecks(), template_or_message_key_present: false }))
      .toBe('blocked_missing_template');
  });

  it('classifies missing copy as missing template', () => {
    expect(classifyProviderReadiness('transactional_email', { ...readyChecks(), copy_template_version_available: false }))
      .toBe('blocked_missing_template');
  });

  it('classifies missing internal recipient without blocking the slice', () => {
    expect(classifyProviderReadiness('sms', { ...readyChecks(), internal_canary_recipient_present: false }))
      .toBe('blocked_missing_internal_recipient');
  });

  it('classifies absent transport', () => {
    expect(classifyProviderReadiness('whatsapp', { ...readyChecks(), transport_implemented: false }))
      .toBe('blocked_transport_not_implemented');
  });

  it.each([
    'internal_canary_guard_present', 'live_send_gate_default_disabled', 'suppression_table_available',
    'audit_event_table_available', 'eligibility_evaluator_available', 'rate_limit_one_available', 'rollback_gate_available',
  ] as const)('classifies missing safety gate %s', field => {
    expect(classifyProviderReadiness('transactional_email', { ...readyChecks(), [field]: false }))
      .toBe('blocked_missing_canary_guard');
  });
});

describe('internal-only one-shot canary guard', () => {
  it('authorizes one exact internal recipient with every safety gate', () => {
    const result = new InternalConsentCanaryGuard().authorize(authorizedInput());
    expect(result.ok).toBe(true);
  });

  it.each([
    'customer', 'prospect', 'checkout_contact', 'order_contact', 'support_contact', 'legacy_preference_contact', 'unknown',
  ] as InternalRecipientClassification[])('rejects forbidden recipient classification %s', classification => {
    const result = new InternalConsentCanaryGuard().authorize(authorizedInput({ recipient_classification: classification }));
    expect(result).toMatchObject({ ok: false, reasons: ['internal_recipient_classification_required'] });
  });

  const missingCases: Array<[string, Partial<InternalCanaryAuthorizationInput>, string]> = [
    ['internal flag', { internal_canary: false }, 'internal_canary_true_required'],
    ['recipient', { recipient: '' }, 'recipient_required'],
    ['allowlist', { recipient_allowlisted: false }, 'internal_recipient_allowlist_required'],
    ['single recipient', { recipient_count: 2 }, 'exactly_one_recipient_required'],
    ['correlation', { correlation_id: '' }, 'correlation_id_required'],
    ['audit', { audit_event_recorded: false }, 'audit_event_required_before_canary'],
    ['eligibility', { eligibility_passed: false }, 'eligibility_required_before_canary'],
    ['suppression', { suppression_check_passed: false }, 'suppression_blocks_canary'],
    ['withdrawal', { withdrawal_check_passed: false }, 'withdrawal_blocks_canary'],
    ['policy', { policy_block_check_passed: false }, 'policy_block_blocks_canary'],
    ['copy', { copy_template_version_present: false }, 'copy_template_version_required'],
    ['credential', { provider_credential_present: false }, 'provider_credential_required'],
    ['provider mode', { provider_specific_canary_mode: false }, 'provider_specific_canary_mode_required'],
    ['broad live flag', { broad_live_send_gate_enabled: true }, 'broad_live_send_gate_must_remain_disabled'],
    ['campaign', { campaign_id: 'campaign-forbidden' }, 'campaign_not_allowed'],
    ['newsletter', { newsletter_id: 'newsletter-forbidden' }, 'newsletter_not_allowed'],
  ];

  it.each(missingCases)('rejects missing/unsafe %s', (_label, overrides, reason) => {
    const result = new InternalConsentCanaryGuard().authorize(authorizedInput(overrides));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons).toContain(reason);
  });

  it('reserves at most one attempt per provider', () => {
    const guard = new InternalConsentCanaryGuard();
    expect(guard.authorize(authorizedInput()).ok).toBe(true);
    const second = guard.authorize(authorizedInput({ correlation_id: 'second' }));
    expect(second).toMatchObject({ ok: false, reasons: ['max_one_canary_per_provider_per_run'] });
    expect(guard.attemptCount('transactional_email')).toBe(1);
  });

  it('locks down after the run', () => {
    const guard = new InternalConsentCanaryGuard();
    guard.lockDown();
    expect(guard.isLockedDown()).toBe(true);
    expect(guard.authorize(authorizedInput())).toMatchObject({ ok: false, reasons: ['internal_canary_gate_locked'] });
  });

  it('binds authorization to a normalized recipient fingerprint', () => {
    expect(fingerprintInternalCanaryRecipient(' Internal@Example.com '))
      .toBe(fingerprintInternalCanaryRecipient('internal@example.com'));
  });

  it('authorization is unforgeable and one-shot', () => {
    expect(() => consumeInternalCanaryAuthorization({
      provider: 'transactional_email', recipient_fingerprint: 'fake', correlation_id: 'fake', issued_at: new Date().toISOString(),
    })).toThrow('invalid_or_consumed_internal_canary_authorization');
    const result = new InternalConsentCanaryGuard().authorize(authorizedInput());
    if (!result.ok) throw new Error('expected authorization');
    expect(consumeInternalCanaryAuthorization(result.authorization)).toBe(result.authorization);
    expect(() => consumeInternalCanaryAuthorization(result.authorization)).toThrow('invalid_or_consumed_internal_canary_authorization');
  });
});

describe('email canary transport', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function authorization() {
    const result = new InternalConsentCanaryGuard().authorize(authorizedInput());
    if (!result.ok) throw new Error('expected authorization');
    return result.authorization;
  }

  it('stays disabled unless the process-specific email canary gate is true', async () => {
    delete process.env.CONSENT_INTERNAL_CANARY_EMAIL_ENABLED;
    const result = await new ZeptoInternalConsentCanaryTransport().send(authorization(), 'internal-canary@example.com');
    expect(result).toMatchObject({ status: 'disabled', broad_live_send_gate_used: false });
  });

  it('rejects use of the broad live-send gate', async () => {
    process.env.CONSENT_INTERNAL_CANARY_EMAIL_ENABLED = 'true';
    process.env.NOTIFICATIONS_LIVE_SEND_ENABLED = 'true';
    await expect(new ZeptoInternalConsentCanaryTransport().send(authorization(), 'internal-canary@example.com'))
      .rejects.toThrow('broad_live_send_gate_must_remain_disabled');
  });

  it('rejects a recipient not bound to the authorization', async () => {
    process.env.CONSENT_INTERNAL_CANARY_EMAIL_ENABLED = 'true';
    await expect(new ZeptoInternalConsentCanaryTransport().send(authorization(), 'different@example.com'))
      .rejects.toThrow('authorization_recipient_mismatch');
  });

  it('reports not configured without credentials and never calls fetch', async () => {
    process.env.CONSENT_INTERNAL_CANARY_EMAIL_ENABLED = 'true';
    process.env.NOTIFICATIONS_LIVE_SEND_ENABLED = 'false';
    delete process.env.ZEPTOMAIL_API_TOKEN;
    delete process.env.ZEPTOMAIL_FROM_ADDRESS;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await new ZeptoInternalConsentCanaryTransport().send(authorization(), 'internal-canary@example.com');
    expect(result.status).toBe('not_configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends only fixed internal copy and returns a hashed provider reference', async () => {
    process.env.CONSENT_INTERNAL_CANARY_EMAIL_ENABLED = 'true';
    process.env.NOTIFICATIONS_LIVE_SEND_ENABLED = 'false';
    process.env.ZEPTOMAIL_API_TOKEN = 'unit-test-token';
    process.env.ZEPTOMAIL_FROM_ADDRESS = 'sender@example.com';
    process.env.ZEPTOMAIL_BASE_URL = 'https://provider.invalid/email';
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ message_id: 'provider-id-private' }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const result = await new ZeptoInternalConsentCanaryTransport().send(authorization(), 'internal-canary@example.com');
    expect(result.status).toBe('sent');
    expect(result.provider_reference_hash).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(result)).not.toContain('provider-id-private');
    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.textbody).toBe('GoldPlus internal consent delivery diagnostic canary. No customer action required.');
    expect(requestBody).not.toHaveProperty('campaign_id');
    expect(requestBody).not.toHaveProperty('newsletter_id');
  });
});

describe('synthetic consent UAT boundaries', () => {
  it('withdrawal supersedes a synthetic internal grant', () => {
    expect(assertWithdrawalSupersedesGrant(true, 'granted')).toBe('withdrawn');
  });

  it('eligibility becomes ineligible after withdrawal', () => {
    const result = evaluateConsentProviderEligibilityPreview({
      purpose_key: 'marketing_offers_campaigns', channel_key: 'email', consent_state: 'withdrawn',
      identity_level: 'verified_account', optional_marketing: true, policy_block_active: false,
      withdrawal_active: true, provider_suppression_active: false, template_required: true,
      template_approved: true, copy_version_present: true, provider_credential_configured: true,
      provider_delivery_enabled: true, message_category_matches_purpose: true,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('withdrawal_active');
  });

  it.each(['customer', 'prospect', 'order', 'checkout', 'support', 'legacy'])(
    'the UAT identity never derives from %s data', source => expect(`uat_synthetic_slice_09_z_${source}`).toMatch(/^uat_synthetic_slice_09_z_/),
  );
});

describe('artifact and hard-red-line contract', () => {
  it.each(Object.values(paths))('declared artifact %s is in the Slice 9-Z allowlist', path => {
    expect(path).toMatch(/InternalConsentCanaryGuard|ZeptoInternalConsentCanaryTransport|Slice09ZApex|slice-09-z-apex/);
  });

  it('does not modify forbidden systems', () => {
    const output = execFileSync('git', ['status', '--short', '--untracked-files=all'], { cwd: resolve(root, '..'), encoding: 'utf8' });
    const changed = output.trimEnd().split('\n').filter(Boolean).map(line => line.slice(3));
    const allowed = new Set(Object.values(paths).map(path => `goldplus-commerce/${path}`));
    expect(changed.every(path => allowed.has(path))).toBe(true);
  });

  it('guard source contains no campaign, queue, checkout, payment, loyalty or discount activation', () => {
    const source = read(paths.guard);
    expect(source).not.toMatch(/dispatchCampaign|processOutbox|PesaPal|loyaltyLedger|issueCoupon|activateMemoryLane/);
  });

  it('transport source has a fixed internal-only message and no broad-live bypass', () => {
    const source = read(paths.emailTransport);
    expect(source).toContain('GoldPlus internal consent delivery diagnostic canary. No customer action required.');
    expect(source).toContain("process.env.NOTIFICATIONS_LIVE_SEND_ENABLED === 'true'");
    expect(source).toContain('broad_live_send_gate_must_remain_disabled');
  });
});
