import { outboundGovernance } from '../OutboundGovernanceService';
import { classifyMessage } from '../messageClassification';
import { smsText } from '../../../application/notifications/CustomerMessages';
import {
  INotificationProvider,
  NotificationDispatchPayload,
  NotificationDispatchResult,
  NotificationStatus,
} from '../../../application/ports/INotificationProvider';
import { resilientFetch } from '../../http/HttpClient';

export class PahappaCommsSmsAdapter implements INotificationProvider {
  /**
   * Normalize Ugandan phone numbers:
   * - 0700111222 -> 256700111222
   * - +256700111222 -> 256700111222
   * - 256700111222 -> 256700111222
   */
  public normalizeUgandanNumber(phone: string): string | null {
    const clean = phone.replace(/[\s\-()+]/g, '');
    if (!/^\d+$/.test(clean)) return null;

    if (clean.startsWith('0') && clean.length === 10) {
      return '256' + clean.slice(1);
    }
    if (clean.startsWith('256') && clean.length === 12) {
      return clean;
    }
    return null;
  }

  /**
   * Helper to mask phone numbers in logs/errors to protect PII.
   */
  public maskPhone(phone: string): string {
    if (phone.length <= 6) return '******';
    return phone.slice(0, 5) + '******' + phone.slice(-2);
  }

  private sanitizeErrorMessage(msg: string): string {
    let sanitized = msg;
    const apiKey = process.env.SMS_API_KEY;
    const username = process.env.SMS_USERNAME;

    if (apiKey) {
      sanitized = sanitized.replace(new RegExp(apiKey, 'gi'), '******');
    }
    if (username) {
      sanitized = sanitized.replace(new RegExp(username, 'gi'), '******');
    }
    return sanitized;
  }

  async dispatch(payload: NotificationDispatchPayload): Promise<NotificationDispatchResult> {
    // 1. Validate and Normalize Recipient Number
    const rawRecipient = payload.recipient || '';
    const normalizedNumber = this.normalizeUgandanNumber(rawRecipient);
    if (!normalizedNumber) {
      return {
        status: 'FAILED' as NotificationStatus,
        providerCode: 'INVALID_RECIPIENT',
        providerMessage: `Failed to normalize number: Uganda-first check failed.`,
      };
    }

    // 2. Credentials Check
    const username = (process.env.SMS_USERNAME || '').trim();
    const apiKey = (process.env.SMS_API_KEY || '').trim();
    const senderId = (process.env.SMS_SENDER_ID || '').trim();
    const priority = (process.env.SMS_PRIORITY || '0').trim();
    const baseUrl = (process.env.SMS_BASE_URL || 'https://comms.egosms.co/api/v1/json/').trim();

    // 3. ONE governance decision, made by the shared policy.
    //
    // This adapter used to interpret the flags itself: channel-enabled first, then the
    // allowlist, then dry-run, then live-send — an order that differed from the email
    // adapter's, so the same environment refused different messages depending on which
    // channel carried them. It also read neither PROVIDER_DELIVERY_ENABLED nor
    // CUSTOMER_COMMUNICATIONS_ENABLED, which were enforced only by convention.
    const allowlist = (process.env.NOTIFICATIONS_ALLOWED_TEST_RECIPIENTS || '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const recipientAllowlisted = allowlist.some((allowed) => {
      const allowedNormalized = this.normalizeUgandanNumber(allowed);
      return allowedNormalized !== null && allowedNormalized === normalizedNumber;
    });

    const decision = outboundGovernance.decide({
      channel: 'SMS',
      messageClass: classifyMessage(payload),
      recipientClass: recipientAllowlisted ? 'TEST' : 'CUSTOMER',
      // The credential check moves INTO the decision so an unconfigured provider is
      // reported by the same vocabulary as every other block, in the right order.
      providerConfigured: Boolean(username && apiKey && senderId),
      allowlistActive: allowlist.length > 0,
      recipientAllowlisted,
      maskedRecipient: this.maskPhone(normalizedNumber),
    });

    if (decision.kind === 'ALLOW_DRY_RUN') {
      return {
        // DRY_RUN, not SENT. Returning SENT made a simulated message indistinguishable
        // from a delivered one in every metric, dashboard and query — which is what made
        // "did we message customers?" unanswerable from the data.
        status: 'DRY_RUN' as NotificationStatus,
        providerCode: 'DRY_RUN',
        providerMessage: 'SMS simulated. No message was sent.',
      };
    }

    if (decision.kind !== 'ALLOW_LIVE') {
      return {
        status: (decision.kind === 'BLOCK_PROVIDER_NOT_CONFIGURED'
          ? 'NOT_CONFIGURED'
          : 'DISABLED') as NotificationStatus,
        // The decision kind IS the code, and the guard names the exact flag. A caller
        // grouping by code now sees why, not merely that.
        providerCode: decision.kind,
        providerMessage: `SMS not sent: ${decision.guard}.`,
      };
    }

    // 4. The text. A producer may attach one; otherwise it comes from the one
    // customer wording table. It used to fall back to `payload.template`, which
    // would have put "LOYALTY_EXPIRY_WARNING" on a customer's phone.
    const text = String(payload.data?.message || smsText(payload.template, (payload.data || {}) as never) || '').trim();
    if (!text) {
      return {
        status: 'FAILED' as NotificationStatus,
        providerCode: 'NO_MESSAGE_BODY',
        providerMessage: `SMS not sent: no customer wording for template ${payload.template}.`,
      };
    }

    // 5. Live Send Dispatch
    try {
      const body = {
        method: 'SendSms',
        userdata: {
          username: username,
          password: apiKey,
        },
        msgdata: [
          {
            number: normalizedNumber,
            message: text,
            senderid: senderId,
            priority: priority,
          },
        ],
      };

      const timeoutMs = parseInt(process.env.SMS_TIMEOUT_MS || '3000', 10);
      const response = await resilientFetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        breakerName: 'egosms',
        timeoutMs,
      });

      if (!response.ok) {
        return {
          status: 'FAILED' as NotificationStatus,
          providerCode: 'PROVIDER_ERROR',
          providerMessage: `HTTP error status ${response.status}`,
        };
      }

      const resJson: any = await response.json();

      if (resJson && resJson.Status === 'OK') {
        return {
          status: 'SENT' as NotificationStatus,
          providerCode: resJson.MsgFollowUpUniqueCode || 'SENT_OK',
          providerMessage: resJson.Message || 'Successfully Sent!',
        };
      }

      return {
        status: 'FAILED' as NotificationStatus,
        providerCode: 'PROVIDER_ERROR',
        providerMessage: resJson?.Message || 'Unknown error response from SMS provider.',
      };
    } catch (err: any) {
      const isTimeout = err.name === 'AbortError';
      return {
        status: 'FAILED' as NotificationStatus,
        providerCode: 'PROVIDER_ERROR',
        providerMessage: this.sanitizeErrorMessage(isTimeout ? 'Request timed out.' : (err.message || 'Unknown network error.')),
      };
    }
  }

  /**
   * Safe Balance Health Check endpoint method.
   * Connects via "Balance" method payload and returns operational status safely.
   */
  async getBalance(): Promise<{ status: 'PASS' | 'FAIL' | 'NOT_CONFIGURED'; balance?: number; message: string }> {
    const username = (process.env.SMS_USERNAME || '').trim();
    const apiKey = (process.env.SMS_API_KEY || '').trim();
    const baseUrl = (process.env.SMS_BASE_URL || 'https://comms.egosms.co/api/v1/json/').trim();

    if (!username || !apiKey) {
      return {
        status: 'NOT_CONFIGURED',
        message: 'SMS provider credentials missing.',
      };
    }

    try {
      const body = {
        method: 'Balance',
        userdata: {
          username: username,
          password: apiKey,
        },
      };

      const timeoutMs = parseInt(process.env.SMS_TIMEOUT_MS || '3000', 10);
      const response = await resilientFetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        breakerName: 'egosms',
        timeoutMs,
      });

      if (!response.ok) {
        return {
          status: 'FAIL',
          message: `HTTP error status ${response.status}`,
        };
      }

      const resJson: any = await response.json();

      if (resJson && resJson.Status === 'OK') {
        const balanceVal = typeof resJson.Balance === 'number' ? resJson.Balance : parseInt(resJson.Balance, 10);
        return {
          status: 'PASS',
          balance: isNaN(balanceVal) ? 0 : balanceVal,
          message: 'BALANCE_CHECK_OK',
        };
      }

      return {
        status: 'FAIL',
        message: resJson?.Message || 'Failed response status from balance check.',
      };
    } catch (err: any) {
      const isTimeout = err.name === 'AbortError';
      return {
        status: 'FAIL',
        message: this.sanitizeErrorMessage(isTimeout ? 'Request timed out.' : (err.message || 'Unknown network error during balance check.')),
      };
    }
  }
}
