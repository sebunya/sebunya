import { createHash } from 'node:crypto';
import {
  consumeInternalCanaryAuthorization,
  fingerprintInternalCanaryRecipient,
  type InternalCanaryAuthorization,
} from '../../application/services/consent/InternalConsentCanaryGuard';
import {
  classifyTransactionalEmailFailure,
  redactTransactionalEmailProviderCode,
  type RedactedTransactionalEmailFailure,
  type TransactionalEmailFailureClassification,
} from '../../application/services/consent/TransactionalEmailFailureForensics';
import { parseRateLimitResponse } from '../../application/services/consent/EmailRateLimitRecovery';
import { resilientFetch } from '../http/HttpClient';

export interface InternalCanaryDeliveryResult {
  status: 'sent' | 'failed' | 'disabled' | 'not_configured';
  provider: 'transactional_email';
  provider_reference_hash: string | null;
  correlation_id: string;
  recipient_masked: string;
  broad_live_send_gate_used: false;
  failure: RedactedTransactionalEmailFailure | null;
  provider_family: 'zeptomail';
  transport_name: 'zeptomail_internal_email_diagnostic';
  http_status: number | null;
  provider_status: 'accepted' | 'failed' | 'not_attempted';
  provider_error_code: string | null;
  provider_error_category: TransactionalEmailFailureClassification | null;
  retryable: boolean | null;
  response_received: boolean;
  network_error: boolean;
  timeout: boolean;
  redacted_response_summary: string;
  retry_after_present: boolean;
  retry_after_seconds: number | null;
  retry_after_timestamp: string | null;
  rate_limit_reset_present: boolean;
  rate_limit_reset_timestamp: string | null;
}

interface DiagnosticCapture {
  http_status: number | null;
  provider_status: InternalCanaryDeliveryResult['provider_status'];
  provider_error_code: string | null;
  provider_error_category: TransactionalEmailFailureClassification | null;
  retryable: boolean | null;
  response_received: boolean;
  network_error: boolean;
  timeout: boolean;
  redacted_response_summary: string;
  retry_after_present: boolean;
  retry_after_seconds: number | null;
  retry_after_timestamp: string | null;
  rate_limit_reset_present: boolean;
  rate_limit_reset_timestamp: string | null;
}

const NOT_ATTEMPTED: DiagnosticCapture = Object.freeze({
  http_status: null,
  provider_status: 'not_attempted',
  provider_error_code: null,
  provider_error_category: null,
  retryable: null,
  response_received: false,
  network_error: false,
  timeout: false,
  redacted_response_summary: 'provider request not attempted',
  retry_after_present: false,
  retry_after_seconds: null,
  retry_after_timestamp: null,
  rate_limit_reset_present: false,
  rate_limit_reset_timestamp: null,
});

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const [host = '', tld = ''] = domain.split('.');
  return `${local.slice(0, 2)}***@${host.slice(0, 2)}***${tld ? `.${tld}` : ''}`;
}

function referenceHash(value: unknown): string | null {
  const reference = typeof value === 'string' ? value : '';
  return reference ? createHash('sha256').update(reference, 'utf8').digest('hex').slice(0, 16) : null;
}

export class ZeptoInternalConsentCanaryTransport {
  async send(
    authorization: InternalCanaryAuthorization,
    recipient: string,
  ): Promise<InternalCanaryDeliveryResult> {
    const approved = consumeInternalCanaryAuthorization(authorization);
    if (approved.provider !== 'transactional_email') throw new Error('authorization_provider_mismatch');
    if (approved.recipient_fingerprint !== fingerprintInternalCanaryRecipient(recipient)) {
      throw new Error('authorization_recipient_mismatch');
    }
    if (process.env.CONSENT_INTERNAL_CANARY_EMAIL_ENABLED !== 'true') {
      return this.result('disabled', approved, recipient, null, null, NOT_ATTEMPTED);
    }
    if (process.env.NOTIFICATIONS_LIVE_SEND_ENABLED === 'true') {
      throw new Error('broad_live_send_gate_must_remain_disabled');
    }

    const token = (process.env.ZEPTOMAIL_API_TOKEN ?? '').trim();
    const fromAddress = (process.env.ZEPTOMAIL_FROM_ADDRESS ?? '').trim();
    const baseUrl = (process.env.ZEPTOMAIL_BASE_URL ?? 'https://api.zeptomail.com/v1.1/email').trim();
    if (!token || !fromAddress || !baseUrl) {
      return this.result('not_configured', approved, recipient, null,
        classifyTransactionalEmailFailure({ missing_configuration: true }), NOT_ATTEMPTED);
    }

    try {
      const response = await resilientFetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Zoho-enczapikey ${token}`,
        },
        body: JSON.stringify({
          from: { address: fromAddress, name: 'GoldPlus' },
          to: [{ email_address: { address: recipient, name: 'GoldPlus Internal Canary' } }],
          subject: 'GoldPlus internal consent delivery diagnostic canary',
          textbody: 'GoldPlus internal consent delivery diagnostic canary. No customer action required.',
          htmlbody: '<p>GoldPlus internal consent delivery diagnostic canary. No customer action required.</p>',
          track_clicks: false,
          track_opens: false,
          client_reference: approved.correlation_id,
        }),
        breakerName: 'zeptomail-internal-consent-canary',
        timeoutMs: Number.parseInt(process.env.ZEPTOMAIL_TIMEOUT_MS ?? '3000', 10),
      });
      if (!response.ok) {
        const providerCode = await this.readProviderCode(response);
        const failure = classifyTransactionalEmailFailure({ response_status: response.status, provider_code: providerCode });
        return this.result('failed', approved, recipient, null, failure, this.captureFailure(
          response.status, providerCode, failure, true, false, false,
          parseRateLimitResponse({ status: response.status, headers: response.headers }),
        ));
      }
      const body = await response.json() as {
        data?: Array<{ message_id?: string }>;
        message?: string;
        error?: { code?: unknown; message?: unknown };
        status?: string;
      };
      if (body.error || body.status === 'failure') {
        const providerCode = body.error?.code ?? body.error?.message ?? body.status;
        const failure = classifyTransactionalEmailFailure({ response_status: response.status, provider_code: providerCode });
        return this.result('failed', approved, recipient, null, failure, this.captureFailure(
          response.status, providerCode, failure, true, false, false,
          parseRateLimitResponse({ status: response.status, headers: response.headers }),
        ));
      }
      const providerReference = body.data?.[0]?.message_id ?? (body.message === 'success' ? 'success' : 'accepted');
      return this.result('sent', approved, recipient, providerReference, null, Object.freeze({
        http_status: response.status,
        provider_status: 'accepted',
        provider_error_code: null,
        provider_error_category: null,
        retryable: false,
        response_received: true,
        network_error: false,
        timeout: false,
        redacted_response_summary: `HTTP ${response.status}; provider accepted one internal diagnostic message`,
        retry_after_present: false,
        retry_after_seconds: null,
        retry_after_timestamp: null,
        rate_limit_reset_present: false,
        rate_limit_reset_timestamp: null,
      }));
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      const statusMatch = error instanceof Error ? error.message.match(/HTTP error status (\d{3})/) : null;
      const httpStatus = statusMatch ? Number(statusMatch[1]) : null;
      const failure = classifyTransactionalEmailFailure({
        response_status: httpStatus,
        timed_out: timedOut,
      });
      return this.result('failed', approved, recipient, null, failure, this.captureFailure(
        httpStatus, null, failure, httpStatus !== null, !timedOut && httpStatus === null, timedOut,
      ));
    }
  }

  private result(
    status: InternalCanaryDeliveryResult['status'],
    authorization: InternalCanaryAuthorization,
    recipient: string,
    providerReference: string | null,
    failure: RedactedTransactionalEmailFailure | null,
    capture: DiagnosticCapture,
  ): InternalCanaryDeliveryResult {
    return Object.freeze({
      status,
      provider: 'transactional_email',
      provider_reference_hash: referenceHash(providerReference),
      correlation_id: authorization.correlation_id,
      recipient_masked: maskEmail(recipient),
      broad_live_send_gate_used: false,
      failure,
      provider_family: 'zeptomail',
      transport_name: 'zeptomail_internal_email_diagnostic',
      ...capture,
    });
  }

  private captureFailure(
    httpStatus: number | null,
    providerCode: unknown,
    failure: RedactedTransactionalEmailFailure,
    responseReceived: boolean,
    networkError: boolean,
    timeout: boolean,
    rateLimit?: ReturnType<typeof parseRateLimitResponse>,
  ): DiagnosticCapture {
    return Object.freeze({
      http_status: httpStatus,
      provider_status: 'failed',
      provider_error_code: redactTransactionalEmailProviderCode(providerCode),
      provider_error_category: failure.classification,
      retryable: failure.retryable === 'yes',
      response_received: responseReceived,
      network_error: networkError,
      timeout,
      redacted_response_summary: httpStatus === null
        ? `no provider response; category ${failure.classification}`
        : `HTTP ${httpStatus}; category ${failure.classification}`,
      retry_after_present: rateLimit?.retry_after_present ?? false,
      retry_after_seconds: rateLimit?.retry_after_seconds ?? null,
      retry_after_timestamp: rateLimit?.retry_after_timestamp ?? null,
      rate_limit_reset_present: rateLimit?.rate_limit_reset_present ?? false,
      rate_limit_reset_timestamp: rateLimit?.rate_limit_reset_timestamp ?? null,
    });
  }

  private async readProviderCode(response: Response): Promise<unknown> {
    try {
      const body = await response.json() as { error?: { code?: unknown; message?: unknown } };
      return body.error?.code ?? body.error?.message ?? null;
    } catch {
      return null;
    }
  }
}
