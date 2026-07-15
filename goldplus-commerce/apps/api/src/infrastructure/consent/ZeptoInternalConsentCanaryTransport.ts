import { createHash } from 'node:crypto';
import {
  consumeInternalCanaryAuthorization,
  fingerprintInternalCanaryRecipient,
  type InternalCanaryAuthorization,
} from '../../application/services/consent/InternalConsentCanaryGuard';
import {
  classifyTransactionalEmailFailure,
  type RedactedTransactionalEmailFailure,
} from '../../application/services/consent/TransactionalEmailFailureForensics';
import { resilientFetch } from '../http/HttpClient';

export interface InternalCanaryDeliveryResult {
  status: 'sent' | 'failed' | 'disabled' | 'not_configured';
  provider: 'transactional_email';
  provider_reference_hash: string | null;
  correlation_id: string;
  recipient_masked: string;
  broad_live_send_gate_used: false;
  failure: RedactedTransactionalEmailFailure | null;
}

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
      return this.result('disabled', approved, recipient, null, null);
    }
    if (process.env.NOTIFICATIONS_LIVE_SEND_ENABLED === 'true') {
      throw new Error('broad_live_send_gate_must_remain_disabled');
    }

    const token = (process.env.ZEPTOMAIL_API_TOKEN ?? '').trim();
    const fromAddress = (process.env.ZEPTOMAIL_FROM_ADDRESS ?? '').trim();
    const baseUrl = (process.env.ZEPTOMAIL_BASE_URL ?? 'https://api.zeptomail.com/v1.1/email').trim();
    if (!token || !fromAddress || !baseUrl) {
      return this.result('not_configured', approved, recipient, null,
        classifyTransactionalEmailFailure({ missing_configuration: true }));
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
          subject: 'GoldPlus internal consent delivery canary',
          textbody: 'GoldPlus internal consent delivery canary. No customer action required.',
          htmlbody: '<p>GoldPlus internal consent delivery canary. No customer action required.</p>',
          track_clicks: false,
          track_opens: false,
          client_reference: approved.correlation_id,
        }),
        breakerName: 'zeptomail-internal-consent-canary',
        timeoutMs: Number.parseInt(process.env.ZEPTOMAIL_TIMEOUT_MS ?? '3000', 10),
      });
      if (!response.ok) {
        const providerCode = await this.readProviderCode(response);
        return this.result('failed', approved, recipient, null,
          classifyTransactionalEmailFailure({ response_status: response.status, provider_code: providerCode }));
      }
      const body = await response.json() as { data?: Array<{ message_id?: string }>; message?: string };
      const providerReference = body.data?.[0]?.message_id ?? (body.message === 'success' ? 'success' : 'accepted');
      return this.result('sent', approved, recipient, providerReference, null);
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      const statusMatch = error instanceof Error ? error.message.match(/HTTP error status (\d{3})/) : null;
      return this.result('failed', approved, recipient, null, classifyTransactionalEmailFailure({
        response_status: statusMatch ? Number(statusMatch[1]) : null,
        timed_out: timedOut,
      }));
    }
  }

  private result(
    status: InternalCanaryDeliveryResult['status'],
    authorization: InternalCanaryAuthorization,
    recipient: string,
    providerReference: string | null,
    failure: RedactedTransactionalEmailFailure | null,
  ): InternalCanaryDeliveryResult {
    return Object.freeze({
      status,
      provider: 'transactional_email',
      provider_reference_hash: referenceHash(providerReference),
      correlation_id: authorization.correlation_id,
      recipient_masked: maskEmail(recipient),
      broad_live_send_gate_used: false,
      failure,
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
