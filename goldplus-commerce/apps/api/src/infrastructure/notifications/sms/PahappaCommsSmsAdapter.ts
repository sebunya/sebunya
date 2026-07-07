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
    const dryRun = process.env.NOTIFICATIONS_DRY_RUN === 'true';
    const liveEnabled = process.env.NOTIFICATIONS_LIVE_SEND_ENABLED === 'true';
    const smsEnabled = process.env.NOTIFICATIONS_SMS_ENABLED === 'true';

    // 1. Guard check: Is SMS channel enabled?
    if (!smsEnabled) {
      return {
        status: 'DISABLED' as NotificationStatus,
        providerCode: 'CHANNEL_DISABLED',
        providerMessage: 'SMS channel is disabled.',
      };
    }

    // 2. Validate and Normalize Recipient Number
    const rawRecipient = payload.recipient || '';
    const normalizedNumber = this.normalizeUgandanNumber(rawRecipient);
    if (!normalizedNumber) {
      return {
        status: 'FAILED' as NotificationStatus,
        providerCode: 'INVALID_RECIPIENT',
        providerMessage: `Failed to normalize number: Uganda-first check failed.`,
      };
    }

    // 3. Credentials Check
    const username = (process.env.SMS_USERNAME || '').trim();
    const apiKey = (process.env.SMS_API_KEY || '').trim();
    const senderId = (process.env.SMS_SENDER_ID || '').trim();
    const priority = (process.env.SMS_PRIORITY || '0').trim();
    const baseUrl = (process.env.SMS_BASE_URL || 'https://comms.egosms.co/api/v1/json/').trim();

    if (!username || !apiKey || !senderId) {
      return {
        status: 'NOT_CONFIGURED' as NotificationStatus,
        providerCode: 'NOT_CONFIGURED',
        providerMessage: 'SMS provider credentials missing.',
      };
    }

    // 4. Test Recipient Allowlist Check
    const rawAllowlist = process.env.NOTIFICATIONS_ALLOWED_TEST_RECIPIENTS || '';
    const allowlist = rawAllowlist
      .split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0);

    const isAllowlisted = allowlist.some(allowed => {
      const allowedNormalized = this.normalizeUgandanNumber(allowed);
      return allowedNormalized && allowedNormalized === normalizedNumber;
    });

    if (allowlist.length > 0 && !isAllowlisted) {
      console.log(`[SMS Dry-Run Blocked] Recipient ${this.maskPhone(normalizedNumber)} is not allowlisted.`);
      return {
        status: 'DISABLED' as NotificationStatus,
        providerCode: 'BLOCKED_BY_ALLOWLIST',
        providerMessage: 'Recipient is not in the test-recipient allowlist.',
      };
    }

    // 5. Dry-Run Check
    if (dryRun) {
      console.log(`[SMS Dry-Run Log] Sender ID: ${senderId} | Recipient: ${this.maskPhone(normalizedNumber)} | Msg: "${payload.data.message || payload.template}"`);
      return {
        status: 'SENT' as NotificationStatus,
        providerCode: 'DRY_RUN_SUCCESS',
        providerMessage: 'SMS simulated successfully (Dry-Run).',
      };
    }

    // 6. Live-Send Global Guard Check
    if (!liveEnabled) {
      return {
        status: 'DISABLED' as NotificationStatus,
        providerCode: 'BLOCKED_BY_LIVE_SEND_DISABLED',
        providerMessage: 'Live dispatch is globally disabled.',
      };
    }

    // 7. Live Send Dispatch
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
            message: String(payload.data.message || payload.template),
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
