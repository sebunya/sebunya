export const TRANSACTIONAL_EMAIL_FAILURE_CLASSIFICATIONS = [
  'missing_configuration',
  'invalid_credential',
  'unauthorized',
  'forbidden_sender',
  'domain_not_verified',
  'recipient_rejected',
  'payload_validation',
  'template_missing',
  'rate_limited',
  'provider_5xx',
  'network_timeout',
  'transport_adapter_bug',
  'unknown',
] as const;

export type TransactionalEmailFailureClassification =
  typeof TRANSACTIONAL_EMAIL_FAILURE_CLASSIFICATIONS[number];

export interface TransactionalEmailFailureEvidence {
  response_status?: number | null;
  provider_code?: unknown;
  timed_out?: boolean;
  missing_configuration?: boolean;
  adapter_bug_confirmed?: boolean;
}

export interface RedactedTransactionalEmailFailure {
  classification: TransactionalEmailFailureClassification;
  provider_status_category: 'none' | 'http_4xx' | 'http_5xx' | 'http_other';
  provider_code_category: TransactionalEmailFailureClassification | 'unavailable';
  retryable: 'yes' | 'no' | 'unknown';
  safe_local_fix_available: boolean;
  requires_provider_action: boolean;
}

const hints: ReadonlyArray<readonly [RegExp, TransactionalEmailFailureClassification]> = [
  [/domain.*(unverified|not.verified)|unverified.*domain/, 'domain_not_verified'],
  [/(sender|from).*(forbidden|invalid|not.allowed|not.verified)/, 'forbidden_sender'],
  [/template.*(missing|invalid|not.found)/, 'template_missing'],
  [/(recipient|mailbox|address).*(reject|invalid|suppress|not.allowed)/, 'recipient_rejected'],
  [/(invalid|expired).*(credential|token|key)|credential.*invalid/, 'invalid_credential'],
  [/unauthori[sz]ed|authentication.*fail/, 'unauthorized'],
  [/rate.*limit|too.many.requests/, 'rate_limited'],
  [/payload|validation|invalid.*request|bad.*request/, 'payload_validation'],
];

function classifyCode(value: unknown): TransactionalEmailFailureClassification | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase().slice(0, 256);
  return hints.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

function statusCategory(status: number | null | undefined): RedactedTransactionalEmailFailure['provider_status_category'] {
  if (!status) return 'none';
  if (status >= 400 && status < 500) return 'http_4xx';
  if (status >= 500) return 'http_5xx';
  return 'http_other';
}

export function classifyTransactionalEmailFailure(
  evidence: TransactionalEmailFailureEvidence,
): RedactedTransactionalEmailFailure {
  const status = evidence.response_status;
  const codeClassification = classifyCode(evidence.provider_code);
  let classification: TransactionalEmailFailureClassification = 'unknown';

  if (evidence.missing_configuration) classification = 'missing_configuration';
  else if (evidence.timed_out) classification = 'network_timeout';
  else if (codeClassification) classification = codeClassification;
  else if (status === 401) classification = 'unauthorized';
  else if (status === 429) classification = 'rate_limited';
  else if (status && status >= 500) classification = 'provider_5xx';
  else if (status === 400 || status === 422) classification = 'payload_validation';
  else if (evidence.adapter_bug_confirmed) classification = 'transport_adapter_bug';

  const retryable = classification === 'rate_limited' || classification === 'provider_5xx'
    || classification === 'network_timeout' ? 'yes'
    : classification === 'unknown' ? 'unknown' : 'no';
  const safeLocal = classification === 'payload_validation' || classification === 'transport_adapter_bug';
  const providerAction = [
    'invalid_credential', 'unauthorized', 'forbidden_sender', 'domain_not_verified',
    'recipient_rejected', 'template_missing', 'missing_configuration',
  ].includes(classification);

  return Object.freeze({
    classification,
    provider_status_category: statusCategory(status),
    provider_code_category: codeClassification ?? 'unavailable',
    retryable,
    safe_local_fix_available: safeLocal,
    requires_provider_action: providerAction,
  });
}

export interface EmailCanaryRerunReadiness {
  previous_failure_classified: boolean;
  remediation_verified: boolean;
  internal_recipient_allowlisted: boolean;
  credential_present: boolean;
  sender_present: boolean;
  host_present: boolean;
  payload_valid: boolean;
  suppression_clear: boolean;
  withdrawal_clear: boolean;
  policy_clear: boolean;
  copy_version_present: boolean;
  audit_available: boolean;
  internal_canary_gate_only: boolean;
  max_attempts_one: boolean;
  broad_live_send_disabled: boolean;
}

export function assessEmailCanaryRerunReadiness(input: EmailCanaryRerunReadiness) {
  const blockers = (Object.entries(input) as Array<[keyof EmailCanaryRerunReadiness, boolean]>)
    .filter(([, ready]) => !ready)
    .map(([key]) => key);
  return Object.freeze({ permitted: blockers.length === 0, blockers: Object.freeze(blockers) });
}
