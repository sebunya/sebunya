import { outboundGovernance } from '../OutboundGovernanceService';
import { failsReleaseReadiness } from '../../../domain/notifications/OutboundGovernancePolicy';
import { classifyMessage } from '../messageClassification';
import {
  INotificationProvider,
  NotificationDispatchPayload,
  NotificationDispatchResult,
  NotificationStatus,
} from '../../../application/ports/INotificationProvider';
import { NotificationTemplateRenderer } from '../../../application/use-cases/notifications/NotificationTemplateRenderer';
import { resilientFetch } from '../../http/HttpClient';

export class ZeptoMailAdapter implements INotificationProvider {
  private readonly renderer = new NotificationTemplateRenderer();

  /**
   * Helper to mask email addresses in logs/errors to protect PII.
   */
  public maskEmail(email: string): string {
    const parts = email.split('@');
    if (parts.length !== 2) return '******';
    const [local, domain] = parts;
    const maskedLocal = local.length <= 2 ? '**' : local.slice(0, 2) + '***';
    
    const domainParts = domain.split('.');
    const maskedDomain = domainParts
      .map((part, i) => {
        if (i === domainParts.length - 1) return part; // Keep TLD like .com visible
        return part.length <= 2 ? '**' : part.slice(0, 2) + '***';
      })
      .join('.');

    return `${maskedLocal}@${maskedDomain}`;
  }

  private sanitizeErrorMessage(msg: string): string {
    let sanitized = msg;
    const token = process.env.ZEPTOMAIL_API_TOKEN;
    if (token) {
      sanitized = sanitized.replace(new RegExp(token, 'gi'), '******');
    }
    return sanitized;
  }

  private renderGenericEmail(title: string, message: string, details: Record<string, any>): string {
    const detailsHtml = Object.entries(details)
      .map(([key, value]) => `
        <tr>
          <td style="padding: 10px 12px; font-weight: bold; color: #374151; background-color: #f9fafb; border-bottom: 1px solid #e5e7eb; width: 35%; text-transform: capitalize; font-size: 12px;">${key.replace(/([A-Z])/g, ' $1')}</td>
          <td style="padding: 10px 12px; color: #111827; border-bottom: 1px solid #e5e7eb; font-family: monospace; font-size: 12px; word-break: break-all;">${String(value)}</td>
        </tr>`)
      .join('');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f9fafb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f9fafb; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="background-color: #111827; padding: 32px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 900; color: #f59e0b; letter-spacing: -0.025em; text-transform: uppercase;">GoldPlus</h1>
              <p style="margin: 4px 0 0 0; font-size: 11px; font-weight: bold; color: #9ca3af; letter-spacing: 0.05em; text-transform: uppercase;">System Operations Alert</p>
            </td>
          </tr>
          <!-- Message Body -->
          <tr>
            <td style="padding: 32px 32px 24px 32px; font-size: 14px; line-height: 1.6; color: #374151;">
              <h2 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 900; color: #111827;">${title}</h2>
              <p style="margin: 0 0 20px 0;">${message}</p>
              ${detailsHtml ? `
              <div style="border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; margin: 24px 0;">
                <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                  <tbody>
                    ${detailsHtml}
                  </tbody>
                </table>
              </div>` : ''}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 32px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 11px; color: #9ca3af;">
              <p style="margin: 0; line-height: 1.5;">This email is an automated administrative notification from the GoldPlus Core Engine.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  async dispatch(payload: NotificationDispatchPayload): Promise<NotificationDispatchResult> {
    // 1. Validate Recipient Email Address
    const rawRecipient = (payload.recipient || '').trim();
    if (!rawRecipient || !rawRecipient.includes('@')) {
      return {
        status: 'FAILED' as NotificationStatus,
        providerCode: 'INVALID_RECIPIENT',
        providerMessage: 'Failed to dispatch email: Invalid email address format.',
      };
    }

    // 3. Credentials Check
    const token = (process.env.ZEPTOMAIL_API_TOKEN || '').trim();
    const fromAddr = (process.env.ZEPTOMAIL_FROM_ADDRESS || '').trim();
    const fromName = (process.env.ZEPTOMAIL_FROM_NAME || 'GoldPlus').trim();
    const replyTo = (process.env.ZEPTOMAIL_REPLY_TO || fromAddr).trim();
    const baseUrl = (process.env.ZEPTOMAIL_BASE_URL || 'https://api.zeptomail.com/v1.1/email').trim();

    // 3. ONE governance decision, made by the shared policy.
    //
    // This adapter used to interpret the flags itself, in an order that differed from the
    // SMS adapter's — so the same environment refused different messages depending on
    // which channel carried them. It also read neither PROVIDER_DELIVERY_ENABLED nor
    // CUSTOMER_COMMUNICATIONS_ENABLED, which were enforced only by convention.
    const allowlist = (process.env.NOTIFICATIONS_ALLOWED_TEST_RECIPIENTS || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0);
    const recipientAllowlisted = allowlist.includes(rawRecipient.toLowerCase());
    const messageClass = classifyMessage(payload);

    const decision = outboundGovernance.decide({
      channel: 'EMAIL',
      messageClass,
      // An operational alert goes to staff; anything else is treated as reaching a
      // customer unless it is on the test allowlist.
      recipientClass: messageClass === 'OPERATIONAL'
        ? 'INTERNAL'
        : recipientAllowlisted ? 'TEST' : 'CUSTOMER',
      providerConfigured: Boolean(token && fromAddr),
      allowlistActive: allowlist.length > 0,
      recipientAllowlisted,
      maskedRecipient: this.maskEmail(rawRecipient),
    });

    if (decision.kind !== 'ALLOW_LIVE' && decision.kind !== 'ALLOW_DRY_RUN') {
      return {
        status: (decision.kind === 'BLOCK_PROVIDER_NOT_CONFIGURED'
          ? 'NOT_CONFIGURED'
          : 'DISABLED') as NotificationStatus,
        // The decision kind IS the code, and the guard names the exact flag, so a caller
        // grouping by code sees why rather than merely that.
        providerCode: decision.kind,
        providerMessage: `Email not sent: ${decision.guard}.`,
      };
    }

    // 4. Compile email subject and body content
    const templateSubjectMap: Record<string, string> = {
      'ORDER_RECEIVED_UNPAID': 'GoldPlus - Order Received',
      'ORDER_PAYMENT_PENDING': 'GoldPlus - Payment Pending',
      'ORDER_PAYMENT_SUCCESS': 'GoldPlus - Order Confirmed',
      'ORDER_PAYMENT_FAILED': 'GoldPlus - Payment Failed',
      'ORDER_PAYMENT_CANCELLED': 'GoldPlus - Checkout Cancelled',
      'ORDER_FULFILLMENT_PROCESSING': 'GoldPlus - Order in Processing',
      'ORDER_FULFILLMENT_COMPLETED': 'GoldPlus - Delivery Completed',
      'PAYMENT_SUCCESS': 'GoldPlus - Order Confirmed',
      'PAYMENT_FAILED': 'GoldPlus - Payment Failed',
      'DEALER_APPLICATION': 'GoldPlus - Dealer Application Submitted',
      'NEW_QUOTE_REQUEST': 'GoldPlus - New Quote Request Received',
      'FAKE_REPORT_ALERT': 'GoldPlus - Counterfeit Product Alert',
    };

    let subject = templateSubjectMap[payload.template] || 'GoldPlus Notification';
    let htmlContent = '';
    let textContent = '';

    const isOrderTemplate = [
      'ORDER_RECEIVED_UNPAID',
      'ORDER_PAYMENT_PENDING',
      'ORDER_PAYMENT_SUCCESS',
      'ORDER_PAYMENT_FAILED',
      'ORDER_PAYMENT_CANCELLED',
      'ORDER_FULFILLMENT_PROCESSING',
      'ORDER_FULFILLMENT_COMPLETED',
    ].includes(payload.template);

    if (payload.template === 'ADMIN_ORDER_EMAIL' && typeof payload.data?.html === 'string') {
      // Pre-rendered admin order email (already escaped in the pure domain).
      subject = String(payload.data.subject || subject);
      htmlContent = String(payload.data.html);
      textContent = String(payload.data.text || subject);
    } else if (isOrderTemplate) {
      const orderModel = payload.data?.order || payload.data || {};
      subject = this.renderer.getSubject(payload.template as any);
      htmlContent = this.renderer.renderEmail(payload.template as any, orderModel);
      textContent = this.renderer.renderTextBody(payload.template as any, orderModel);
    } else if (payload.template === 'PAYMENT_SUCCESS' || payload.template === 'PAYMENT_FAILED') {
      // Map outbox routed events to corresponding order-template styles
      const mappedTemplate = payload.template === 'PAYMENT_SUCCESS' ? 'ORDER_PAYMENT_SUCCESS' : 'ORDER_PAYMENT_FAILED';
      const orderModel = payload.data?.order || payload.data || {};
      subject = this.renderer.getSubject(mappedTemplate);
      htmlContent = this.renderer.renderEmail(mappedTemplate, orderModel);
      textContent = this.renderer.renderTextBody(mappedTemplate, orderModel);
    } else {
      // Operations alerts, dealer app, quote request alerts
      const message = String(payload.data?.message || `A system event regarding ${payload.relatedEntity} occurred.`);
      htmlContent = this.renderGenericEmail(subject, message, payload.data || {});
      textContent = `${subject}\n\n${message}\n\n${Object.entries(payload.data || {})
        .filter(([k]) => k !== 'message')
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join('\n')}`;
    }

    // 5. Simulate, if that is what the decision said. The message is rendered first so
    //    a dry run exercises the same rendering path a live send would — a simulation
    //    that skips rendering cannot catch a broken template.
    if (decision.kind === 'ALLOW_DRY_RUN') {
      return {
        // DRY_RUN, not SENT. Returning SENT made a simulated message indistinguishable
        // from a delivered one in every metric, dashboard and query.
        status: 'DRY_RUN' as NotificationStatus,
        providerCode: 'DRY_RUN',
        providerMessage: 'Email simulated. No message was sent.',
      };
    }

    // 6. Live POST to Zoho ZeptoMail API
    try {
      const bodyPayload = {
        from: {
          address: fromAddr,
          name: fromName,
        },
        to: [
          {
            email_address: {
              address: rawRecipient,
              name: String(payload.data?.customerName || 'Customer'),
            },
          },
        ],
        reply_to: [
          {
            address: replyTo,
            name: fromName,
          },
        ],
        subject: subject,
        htmlbody: htmlContent,
        textbody: textContent,
        track_clicks: false,
        track_opens: false,
        client_reference: payload.relatedEntityId || undefined,
      };

      const timeoutMs = parseInt(process.env.ZEPTOMAIL_TIMEOUT_MS || '3000', 10);
      const response = await resilientFetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Zoho-enczapikey ${token}`,
        },
        body: JSON.stringify(bodyPayload),
        breakerName: 'zeptomail',
        timeoutMs,
      });

      if (!response.ok) {
        // The provider's own explanation, kept.
        //
        // This used to report only `HTTP error status 429`, which is why nobody
        // could tell whether ZeptoMail was rate-limiting a burst, refusing a
        // daily quota, or declining because the account itself was restricted —
        // three problems with three different fixes, and 128 dead-lettered
        // emails that all looked identical. A status code is a symptom; the body
        // is the diagnosis.
        //
        // Bounded to 300 characters and never logged with the payload, so a
        // provider message cannot become an unbounded log of customer data.
        const detail = await response.text().catch(() => '');
        const retryAfter = response.headers.get('retry-after');
        return {
          status: 'FAILED' as NotificationStatus,
          providerCode: `PROVIDER_HTTP_${response.status}`,
          providerMessage: [
            `HTTP error status ${response.status}`,
            retryAfter ? `retry-after=${retryAfter}` : '',
            detail ? detail.replace(/\s+/g, ' ').slice(0, 300) : '',
          ]
            .filter(Boolean)
            .join(' | '),
        };
      }

      const resJson: any = await response.json();

      // ZeptoMail returns success indicators in its JSON
      if (resJson && (resJson.data || resJson.message === 'success' || !resJson.error)) {
        return {
          status: 'SENT' as NotificationStatus,
          providerCode: resJson.data?.[0]?.message_id || 'SENT_OK',
          providerMessage: 'Email successfully sent via ZeptoMail.',
        };
      }

      return {
        status: 'FAILED' as NotificationStatus,
        providerCode: resJson?.error?.code || 'PROVIDER_ERROR',
        providerMessage: resJson?.error?.message || 'Unknown error response from ZeptoMail.',
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
   * Pure Config Validation Health Check.
   * Does NOT make any network/HTTP calls. Validates environment configurations safely.
   */
  async getBalance(): Promise<{ status: 'PASS' | 'WARN' | 'FAIL' | 'NOT_CONFIGURED'; message: string }> {
    const token = (process.env.ZEPTOMAIL_API_TOKEN || '').trim();
    const fromAddr = (process.env.ZEPTOMAIL_FROM_ADDRESS || '').trim();
    const baseUrl = (process.env.ZEPTOMAIL_BASE_URL || 'https://api.zeptomail.com/v1.1/email').trim();
    const replyTo = (process.env.ZEPTOMAIL_REPLY_TO || '').trim();
    const allowlist = (process.env.NOTIFICATIONS_ALLOWED_TEST_RECIPIENTS || '').trim();

    if (!token || !fromAddr) {
      return {
        status: 'NOT_CONFIGURED',
        message: 'ZeptoMail config check: Credentials missing.',
      };
    }

    // 1. Validate Base URL format
    if (!baseUrl.startsWith('https://')) {
      return {
        status: 'FAIL',
        message: 'ZeptoMail config check: Invalid Base URL scheme.',
      };
    }

    // 2. Validate From Email Address format
    if (!fromAddr.includes('@') || fromAddr.length < 5) {
      return {
        status: 'FAIL',
        message: 'ZeptoMail config check: Invalid from email address format.',
      };
    }

    // 3. Validate Reply-To Email Address if configured
    if (replyTo && (!replyTo.includes('@') || replyTo.length < 5)) {
      return {
        status: 'FAIL',
        message: 'ZeptoMail config check: Invalid reply-to email address format.',
      };
    }

    // 4. Validate allowlisted test recipient format if configured
    if (allowlist) {
      const invalidEmails = allowlist.split(',').map(e => e.trim()).filter(e => e.length > 0 && (!e.includes('@') || e.length < 5));
      if (invalidEmails.length > 0) {
        return {
          status: 'FAIL',
          message: 'ZeptoMail config check: Allowlisted test recipient has invalid email format.',
        };
      }
    }

    // 5. Verify safety defaults, through the SAME policy the dispatch path uses.
    //
    // A safety check must not PASS in the case it exists to detect. It previously
    // returned 'PASS' with the warning buried in a message string, so an environment
    // with outbound email unlocked and the dry-run guard off reported the same status as
    // a correctly locked-down one — anything scanning statuses saw PASS.
    //
    // It also re-derived its own flag reading, so this check and the dispatch path could
    // disagree about whether the environment was safe. Asking the policy means they
    // cannot.
    const verdict = outboundGovernance.configurationVerdict('EMAIL', true);

    if (failsReleaseReadiness(verdict)) {
      // A contradictory configuration is a FAIL, not a warning: it must block release
      // readiness and activation, and it names the guard so the operator knows which
      // combination is wrong.
      return {
        status: 'FAIL',
        message:
          `ZeptoMail config check: unsafe outbound configuration (${verdict.guard}). ` +
          'This must be resolved before release; live sending is blocked.',
      };
    }

    if (verdict.kind === 'ALLOW_LIVE') {
      // Live sending is genuinely permitted. Reported as a WARN rather than a PASS
      // because "customer email can leave this system" is a state an operator should be
      // told about explicitly, even when every guard was satisfied deliberately.
      return {
        status: 'WARN',
        message:
          'ZeptoMail config check: configuration is valid and LIVE SENDING IS ENABLED. ' +
          'Customer communications can leave this system.',
      };
    }

    return {
      status: 'PASS',
      message: 'ZeptoMail config check: Configuration validated. Safe dry-run defaults are active.',
    };
  }
}
