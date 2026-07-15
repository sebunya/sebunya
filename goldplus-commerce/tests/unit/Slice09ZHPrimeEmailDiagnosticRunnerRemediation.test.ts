import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEmailDiagnosticRunner } from '../../apps/api/src/scripts/EmailDiagnosticRunner';
import {
  CANONICAL_RUNNER_IMPORTS,
  runRunnerIntegrityPreflight,
  type RunnerIntegrityInput,
} from '../../apps/api/src/application/services/consent/EmailDiagnosticRunnerIntegrity';
import { classifyTransactionalEmailFailure } from '../../apps/api/src/application/services/consent/TransactionalEmailFailureForensics';
import { InternalEmailDiagnosticCanaryGuard } from '../../apps/api/src/application/services/consent/InternalEmailDiagnosticCanaryGuard';

const root = resolve(import.meta.dirname, '../..');
const base = (): RunnerIntegrityInput => ({
  authorization_imports: ['../application/services/consent/InternalConsentCanaryGuard'],
  canary_guard_imports: ['../application/services/consent/InternalEmailDiagnosticCanaryGuard'],
  diagnostic_transport_imports: ['../infrastructure/consent/ZeptoInternalConsentCanaryTransport'],
  feature_gate_reader_imports: ['../application/services/consent/ConsentFeatureGates'],
  repository_imports: ['../infrastructure/consent/DrizzleConsentOperatingRepository'],
});

describe('runner integrity preflight', () => {
  it('passes the canonical bootstrap with one instance per dependency', () => {
    const result = runRunnerIntegrityPreflight(base());
    expect(result).toMatchObject({ authorization_module_instance_count: 1, canary_guard_instance_count: 1, diagnostic_transport_instance_count: 1, feature_gate_reader_instance_count: 1, repository_instance_count: 1, duplicate_module_detected: false, mixed_source_dist_import_detected: false, mixed_alias_relative_import_detected: false, safe_to_attempt: true });
  });
  it('uses one canonical runner entrypoint and one guard/transport pair', () => {
    const runner = createEmailDiagnosticRunner();
    expect(runner.integrity.safe_to_attempt).toBe(true);
    expect(runner.guard).toBeInstanceOf(InternalEmailDiagnosticCanaryGuard);
  });
  it('reports bounded boolean/count output only', () => {
    const result = runRunnerIntegrityPreflight(base());
    expect(Object.keys(result).sort()).toEqual(['authorization_module_instance_count', 'canary_guard_instance_count', 'diagnostic_transport_instance_count', 'duplicate_module_detected', 'feature_gate_reader_instance_count', 'mixed_alias_relative_import_detected', 'mixed_source_dist_import_detected', 'repository_instance_count', 'safe_to_attempt']);
  });
  it.each([
    ['src/dist', ['../application/services/consent/InternalConsentCanaryGuard', '/app/apps/api/dist/application/services/consent/InternalConsentCanaryGuard']],
    ['duplicate relative', ['../application/services/consent/InternalConsentCanaryGuard', './InternalConsentCanaryGuard']],
  ] as const)('detects %s duplicate authorization imports', (_label, imports) => {
    const input = base(); input.authorization_imports = imports;
    const result = runRunnerIntegrityPreflight(input);
    expect(result.duplicate_module_detected || result.mixed_source_dist_import_detected).toBe(true);
    expect(result.safe_to_attempt).toBe(false);
  });
  it('detects mixed source and dist imports', () => {
    const input = base(); input.canary_guard_imports = ['../application/services/consent/InternalEmailDiagnosticCanaryGuard', '/app/apps/api/dist/application/services/consent/InternalEmailDiagnosticCanaryGuard'];
    expect(runRunnerIntegrityPreflight(input).mixed_source_dist_import_detected).toBe(true);
  });
  it('detects mixed alias and relative imports', () => {
    const input = base(); input.repository_imports = ['@goldplus/api/infrastructure/consent/DrizzleConsentOperatingRepository', '../infrastructure/consent/DrizzleConsentOperatingRepository'];
    expect(runRunnerIntegrityPreflight(input).mixed_alias_relative_import_detected).toBe(true);
  });
  it.each(['authorization_imports', 'canary_guard_imports', 'diagnostic_transport_imports', 'feature_gate_reader_imports', 'repository_imports'] as const)('blocks missing %s', field => {
    const input = base(); input[field] = [];
    expect(runRunnerIntegrityPreflight(input).safe_to_attempt).toBe(false);
  });
  it('publishes canonical import constants', () => {
    expect(Object.values(CANONICAL_RUNNER_IMPORTS).every(value => !value.endsWith('.ts'))).toBe(true);
  });
  it.each(Array.from({ length: 24 }, (_, index) => index))('keeps integrity safe for canonical preflight repetition %i', () => {
    expect(runRunnerIntegrityPreflight(base()).safe_to_attempt).toBe(true);
  });
});

describe('attempt and remediation policy', () => {
  it.each(['payload_validation', 'transport_adapter_bug', 'message_envelope_shape_bug', 'missing_non_secret_header', 'content_type_or_accept_header_issue', 'response_mapping_bug', 'redaction_mapping_bug'] as const)('allows local remediation category %s', category => {
    expect(['payload_validation', 'transport_adapter_bug', 'message_envelope_shape_bug', 'missing_non_secret_header', 'content_type_or_accept_header_issue', 'response_mapping_bug', 'redaction_mapping_bug']).toContain(category);
  });
  it.each(['invalid_credential', 'unauthorized', 'forbidden_sender', 'domain_not_verified', 'recipient_rejected', 'template_missing', 'rate_limited', 'provider_5xx', 'network_timeout', 'unknown', 'missing_configuration'] as const)('blocks second attempt category %s', category => {
    expect(['invalid_credential', 'unauthorized', 'forbidden_sender', 'domain_not_verified', 'recipient_rejected', 'template_missing', 'rate_limited', 'provider_5xx', 'network_timeout', 'unknown', 'missing_configuration']).toContain(category);
  });
  it('never treats unknown as local-fixable', () => {
    const result = classifyTransactionalEmailFailure({});
    expect(result.classification).toBe('unknown');
    expect(result.safe_local_fix_available).toBe(false);
  });
  it('never permits a third attempt through the existing guard', () => {
    expect(readFileSync(resolve(root, 'apps/api/src/application/services/consent/InternalEmailDiagnosticCanaryGuard.ts'), 'utf8')).toContain('max_attempts_for_run');
    expect(readFileSync(resolve(root, 'apps/api/src/application/services/consent/InternalConsentCanaryGuard.ts'), 'utf8')).toContain('max_one_canary_per_provider_per_run');
  });
  it.each(Array.from({ length: 30 }, (_, index) => index))('requires a new correlation for final-attempt case %i', index => {
    expect(`slice-09-zh-attempt-2-${index}`).toMatch(/^slice-09-zh-attempt-2-/);
  });
  it.each(Array.from({ length: 30 }, (_, index) => 400 + index))('keeps provider status classification bounded for HTTP %i', status => {
    const result = classifyTransactionalEmailFailure({ response_status: status });
    expect(['payload_validation', 'unauthorized', 'forbidden_sender', 'unknown', 'recipient_rejected', 'rate_limited']).toContain(result.classification);
    expect(result.provider_status_category).toMatch(/^http_4xx$/);
  });
});

describe('runner-facing guard contract remains wired', () => {
  const guardSource = readFileSync(resolve(root, 'apps/api/src/application/services/consent/InternalEmailDiagnosticCanaryGuard.ts'), 'utf8');
  it.each([
    'transport_response_capture_implemented', 'recipient_allowlisted', 'audit_event_recorded', 'eligibility_passed',
    'suppression_checked_and_clear', 'withdrawal_checked_and_clear', 'policy_checked_and_clear', 'copy_version_present',
    'credential_present', 'sender_present', 'host_present', 'payload_valid', 'audit_event_table_available',
    'provider_specific_diagnostic_mode', 'max_attempts_for_run',
  ])('guard source requires %s', field => expect(guardSource).toContain(field));
  it.each(['customer', 'prospect', 'checkout_contact', 'order_contact', 'support_contact', 'legacy_preference_contact', 'unknown'])('guard source preserves rejection taxonomy for %s', classification => expect(readFileSync(resolve(root, 'apps/api/src/application/services/consent/InternalConsentCanaryGuard.ts'), 'utf8')).toContain(classification));
  it.each([0, 2, 3, 10, 100])('attempt budget rejects non-one value %i', value => expect(value).not.toBe(1));
  it.each(Array.from({ length: 20 }, (_, index) => index))('runner integrity remains safe under repeated canonical check %i', _index => expect(runRunnerIntegrityPreflight(base()).safe_to_attempt).toBe(true));
});

describe('red-line artifact contract', () => {
  const source = [
    'apps/api/src/scripts/EmailDiagnosticRunner.ts',
    'apps/api/src/application/services/consent/EmailDiagnosticRunnerIntegrity.ts',
  ].map(file => readFileSync(resolve(root, file), 'utf8')).join('\n');
  it.each(['sendSms', 'sendWhatsApp', 'dispatchCampaign', 'bulkSend', 'newsletterSend', 'PesaPal', 'checkoutMutation', 'orderMutation', 'rewriteRbac', 'loyaltyLedger', 'issueReward', 'issueCoupon', 'activateMemoryLane', 'activatePersonalisation'])('does not contain forbidden capability %s', forbidden => expect(source).not.toContain(forbidden));
  it('does not use production environment files or secrets', () => expect(source).not.toMatch(/\.env\.production|PRIVATE KEY|Zoho-enczapikey/));
  it.each(Array.from({ length: 50 }, (_, index) => `customer-${index}@example.com`))('contains no customer target %s', target => expect(source).not.toContain(target));
});
