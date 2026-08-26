import { emailCopy, whatsappText, smsText, trackOrderUrl, supportPhoneDisplay, type EmailCopy } from '../../notifications/CustomerMessages';

export type NotificationTemplateKey =
  | 'ORDER_RECEIVED_UNPAID'
  | 'ORDER_PAYMENT_PENDING'
  | 'ORDER_PAYMENT_SUCCESS'
  | 'ORDER_PAYMENT_FAILED'
  | 'ORDER_PAYMENT_CANCELLED'
  | 'ORDER_FULFILLMENT_PROCESSING'
  | 'ORDER_FULFILLMENT_COMPLETED';

export const NOTIFICATION_TEMPLATE_KEYS: NotificationTemplateKey[] = [
  'ORDER_RECEIVED_UNPAID',
  'ORDER_PAYMENT_PENDING',
  'ORDER_PAYMENT_SUCCESS',
  'ORDER_PAYMENT_FAILED',
  'ORDER_PAYMENT_CANCELLED',
  'ORDER_FULFILLMENT_PROCESSING',
  'ORDER_FULFILLMENT_COMPLETED',
];

/**
 * Wave 2E-3: operator wording overrides. The provider is INJECTED by
 * infrastructure at boot (a cached read of published override rows) so this
 * application-layer renderer stays free of database imports. Fields fall through
 * individually — a published override with only a subject changes only the
 * subject. Code strings below remain the canonical fallback; wording can never
 * render blank because of a missing row.
 */
export interface TemplateWordingOverride {
  subject?: string | null;
  preheader?: string | null;
  headline?: string | null;
}
export type TemplateOverrideProvider = (key: NotificationTemplateKey) => TemplateWordingOverride | undefined;

let overrideProvider: TemplateOverrideProvider | null = null;
export function setTemplateOverrideProvider(provider: TemplateOverrideProvider | null): void {
  overrideProvider = provider;
}

export interface EmailRenderResult {
  subject: string;
  preheader: string;
  htmlbody: string;
  textbody: string;
}

export class NotificationTemplateRenderer {
  private escapeHtml(str: string | null | undefined): string {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatUgx(amount: number): string {
    const formatted = new Intl.NumberFormat('en-UG', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
    return `UGX ${formatted}`;
  }

  /**
   * Safe subject line mapping according to template type
   */
  public getSubject(template: NotificationTemplateKey): string {
    const override = overrideProvider?.(template)?.subject;
    if (override) return override;
    return this.getDefaultSubject(template);
  }

  /** The code-canonical subject, bypassing any operator override (admin display). */
  public getDefaultSubject(template: NotificationTemplateKey): string {
    return emailCopy(template)?.subject ?? 'An update on your GoldPlus order';
  }

  /**
   * Safe preheader text mapping according to template type
   */
  public getPreheader(template: NotificationTemplateKey): string {
    const override = overrideProvider?.(template)?.preheader;
    if (override) return override;
    return this.getDefaultPreheader(template);
  }

  /** The code-canonical preheader, bypassing any operator override (admin display). */
  public getDefaultPreheader(template: NotificationTemplateKey): string {
    return emailCopy(template)?.preheader ?? 'Open this email to see where your order is.';
  }

  /**
   * Safe headline text mapping according to template type
   */
  private getHeadline(template: NotificationTemplateKey): string {
    const override = overrideProvider?.(template)?.headline;
    if (override) return override;
    return emailCopy(template)?.headline ?? 'An update on your order';
  }

  /**
   * Safe long status message mapping according to template type
   */
  private getStatusMessage(template: NotificationTemplateKey, orderNumber: string, totalUgx: number): string {
    const copy = emailCopy(template, { orderNumber, totalUgx });
    return this.escapeHtml(copy?.body ?? `There is an update on your order ${orderNumber}. Open the tracking page, or call ${supportPhoneDisplay()} and we will explain.`);
  }

  /**
   * Renders the hidden HTML preheader element
   */
  private renderPreheader(preheader: string): string {
    return `<!--[if !mso]><!-->
    <div style="display: none; max-height: 0px; overflow: hidden; font-size: 1px; color: #ffffff; line-height: 1px; font-family: sans-serif;">
      ${this.escapeHtml(preheader)}
    </div>
    <!--<![endif]-->`;
  }

  /**
   * Renders the safe email header block
   */
  private renderEmailHeader(): string {
    return `
    <!-- Header Logo Banner -->
    <tr>
      <td style="background-color: #0A0A0A; padding: 32px 24px; text-align: center; border-bottom: 3px solid #96cc06;">
        <h1 style="margin: 0; font-family: sans-serif; font-size: 26px; font-weight: 900; color: #FFFFFF; letter-spacing: -0.03em; text-transform: uppercase;">GoldPlus</h1>
        <p style="margin: 4px 0 0 0; font-family: sans-serif; font-size: 10px; font-weight: 800; color: #9CA3AF; letter-spacing: 0.1em; text-transform: uppercase;">Verified electronics, Kampala</p>
      </td>
    </tr>`;
  }

  /**
   * Renders the status banner block
   */
  private renderStatusBlock(headline: string, message: string, isSuccess: boolean, customerName?: string): string {
    const bannerBg = isSuccess ? '#F3FBF2' : '#FCFAF2';
    const borderBg = isSuccess ? '#E1F3DF' : '#F7F3E1';
    const fontColor = isSuccess ? '#2B6A25' : '#8A6D1C';
    
    const name = String(customerName || '').trim();
    const greetingHtml = `<p style="margin: 0 0 12px 0; font-family: sans-serif; font-size: 14px; font-weight: bold; color: #0A0A0A;">${name ? `Hello ${this.escapeHtml(name)},` : 'Hello,'}</p>`;

    return `
    <!-- Status headline and contextual text -->
    <tr>
      <td style="padding: 32px 32px 20px 32px; background-color: #FFFFFF;">
        <div style="background-color: ${bannerBg}; border: 1px solid ${borderBg}; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px;">
          <h2 style="margin: 0 0 4px 0; font-family: sans-serif; font-size: 15px; font-weight: 800; color: ${fontColor}; letter-spacing: -0.01em;">${this.escapeHtml(headline)}</h2>
        </div>
        ${greetingHtml}
        <p style="margin: 0; font-family: sans-serif; font-size: 14px; line-height: 1.6; color: #374151;">${message}</p>
      </td>
    </tr>`;
  }

  /**
   * Renders the order parameters outline
   */
  private renderOrderSummary(order: any, formattedTotal: string, dateStr: string): string {
    const escapedRef = this.escapeHtml(order.orderNumber);
    const escapedArea = this.escapeHtml(order.deliveryArea || 'To be confirmed with you');
    const escapedStatus = this.escapeHtml(this.orderStatusWords(order.orderStatus));
    const escapedPayment = this.escapeHtml(this.paymentStatusWords(order.paymentStatus));

    const isPaid = order.paymentStatus === 'paid';
    const payColor = isPaid ? '#22C55E' : '#EAB308';

    return `
    <!-- Order summary parameters metadata box -->
    <tr>
      <td style="padding: 0 32px 24px 32px; background-color: #FFFFFF;">
        <div style="background-color: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 18px;">
          <table width="100%" border="0" cellspacing="0" cellpadding="0" style="font-family: sans-serif; font-size: 12px; line-height: 1.5; border-collapse: collapse;">
            <tr>
              <td style="padding: 4px 0; color: #6B7280; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; width: 45%;">Order Reference</td>
              <td style="padding: 4px 0; text-align: right; font-weight: bold; color: #0A0A0A; font-family: monospace;">${escapedRef}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #6B7280; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">Date Placed</td>
              <td style="padding: 4px 0; text-align: right; color: #374151;">${this.escapeHtml(dateStr)}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #6B7280; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">Status</td>
              <td style="padding: 4px 0; text-align: right; font-weight: bold; color: #0A0A0A; text-transform: uppercase;">${escapedStatus}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #6B7280; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">Payment Status</td>
              <td style="padding: 4px 0; text-align: right; font-weight: bold; color: ${payColor}; text-transform: uppercase;">${escapedPayment}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #6B7280; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">Delivering to</td>
              <td style="padding: 4px 0; text-align: right; color: #374151;">${escapedArea}</td>
            </tr>
          </table>
        </div>
      </td>
    </tr>`;
  }

  /**
   * Renders the itemized product line-items table
   */
  private renderLineItemsTable(items: any[]): string {
    const rows = (items || [])
      .map((item: any) => {
        const name = this.escapeHtml(item.productName || item.name);
        const qty = item.quantity;
        const price = item.unitPrice || item.price || 0;
        const total = price * qty;

        return `
        <tr>
          <td style="padding: 12px 8px; font-family: sans-serif; font-size: 13px; font-weight: bold; color: #0A0A0A; border-bottom: 1px solid #E5E7EB; text-align: left;">
            ${name}
          </td>
          <td style="padding: 12px 8px; font-family: sans-serif; font-size: 13px; font-weight: bold; color: #374151; border-bottom: 1px solid #E5E7EB; text-align: center;">${qty}</td>
          <td style="padding: 12px 8px; font-family: sans-serif; font-size: 13px; color: #4B5563; border-bottom: 1px solid #E5E7EB; text-align: right;">${this.escapeHtml(this.formatUgx(price))}</td>
          <td style="padding: 12px 8px; font-family: sans-serif; font-size: 13px; font-weight: 800; color: #0A0A0A; border-bottom: 1px solid #E5E7EB; text-align: right;">${this.escapeHtml(this.formatUgx(total))}</td>
        </tr>`;
      })
      .join('');

    return `
    <!-- Line Items Table Section -->
    <tr>
      <td style="padding: 0 32px 16px 32px; background-color: #FFFFFF;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-collapse: collapse; border-top: 1px solid #E5E7EB;">
          <thead>
            <tr style="background-color: #F9FAFB;">
              <th style="padding: 10px 8px; font-family: sans-serif; font-size: 10px; font-weight: bold; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #E5E7EB; text-align: left;">Product</th>
              <th style="padding: 10px 8px; font-family: sans-serif; font-size: 10px; font-weight: bold; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #E5E7EB; text-align: center; width: 10%;">Qty</th>
              <th style="padding: 10px 8px; font-family: sans-serif; font-size: 10px; font-weight: bold; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #E5E7EB; text-align: right; width: 25%;">Price</th>
              <th style="padding: 10px 8px; font-family: sans-serif; font-size: 10px; font-weight: bold; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #E5E7EB; text-align: right; width: 25%;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </td>
    </tr>`;
  }

  /**
   * Renders the itemized total calculations card
   */
  private renderTotalBlock(formattedTotal: string): string {
    return `
    <!-- Totals calculation block -->
    <tr>
      <td style="padding: 0 32px 32px 32px; background-color: #FFFFFF;">
        <table align="right" width="260" border="0" cellspacing="0" cellpadding="0" style="font-family: sans-serif; font-size: 13px; line-height: 1.5; border-collapse: collapse;">
          <tr>
            <td style="padding: 4px 0; color: #6B7280; text-align: left;">Subtotal</td>
            <td style="padding: 4px 0; font-weight: bold; color: #0A0A0A; text-align: right;">${this.escapeHtml(formattedTotal)}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #6B7280; text-align: left;">Delivery Zone Fee</td>
            <td style="padding: 4px 0; font-style: italic; color: #9CA3AF; text-align: right;">Calculated post-zone</td>
          </tr>
          <tr style="border-top: 1px solid #E5E7EB;">
            <td style="padding: 12px 0 0 0; font-size: 14px; font-weight: bold; color: #0A0A0A; text-align: left;">Total</td>
            <td style="padding: 12px 0 0 0; font-size: 16px; font-weight: 900; color: #0A0A0A; text-align: right;">${this.escapeHtml(formattedTotal)}</td>
          </tr>
        </table>
        <div style="clear: both;"></div>
      </td>
    </tr>`;
  }

  /**
   * Renders the transactional button and safe text-url fallback underneath
   */
  private renderPrimaryCta(template: NotificationTemplateKey, orderNumber: string): string {
    const trackUrl = trackOrderUrl(orderNumber);
    let ctaLabel = 'Track this order';

    switch (template) {
      case 'ORDER_RECEIVED_UNPAID':
        ctaLabel = 'Pay for this order';
        break;
      case 'ORDER_PAYMENT_PENDING':
      case 'ORDER_PAYMENT_SUCCESS':
      case 'ORDER_FULFILLMENT_PROCESSING':
        ctaLabel = 'Track this order';
        break;
      case 'ORDER_PAYMENT_FAILED':
        ctaLabel = 'Try payment again';
        break;
      case 'ORDER_PAYMENT_CANCELLED':
        ctaLabel = 'Pay for this order';
        break;
      case 'ORDER_FULFILLMENT_COMPLETED':
        ctaLabel = 'See this order';
        break;
    }

    return `
    <!-- CTA Button and raw link backup -->
    <tr>
      <td style="padding: 0 32px 32px 32px; background-color: #FFFFFF; text-align: center;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center">
              <table border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="background-color: #96cc06; border-radius: 6px;">
                    <a href="${trackUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; font-family: sans-serif; font-size: 13px; font-weight: 900; color: #0A0A0A; text-decoration: none; text-transform: uppercase; letter-spacing: 0.05em; border: 1px solid #96cc06; border-radius: 6px;">
                      ${this.escapeHtml(ctaLabel)}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding-top: 16px; font-family: sans-serif; font-size: 10px; color: #9CA3AF; line-height: 1.4;">
              If the button does not work, copy this link into your browser:<br>
              <a href="${trackUrl}" target="_blank" style="color: #96cc06; text-decoration: none; font-weight: bold; word-break: break-all;">${this.escapeHtml(trackUrl)}</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
  }

  /**
   * Safe Link Builder for WhatsApp Support Handoff
   */
  public buildWhatsAppHandoff(orderNumber: string, customerName?: string): { url: string; label: string } | null {
    const envVal = process.env.WHATSAPP_SUPPORT_NUMBER;
    if (envVal !== undefined && (envVal.trim() === '' || envVal.trim().toLowerCase() === 'none')) {
      return null;
    }

    const supportNumber = (envVal || '256705004545').trim();
    const supportLabel = (process.env.WHATSAPP_SUPPORT_LABEL || 'GoldPlus Support').trim();

    const message = `Hello GoldPlus, I need help with order ${orderNumber}`;
    const url = `https://wa.me/${supportNumber}?text=${encodeURIComponent(message)}`;

    return {
      url,
      label: supportLabel,
    };
  }

  /**
   * Renders the support panel and WhatsApp handoff
   */
  private renderSupportBlock(orderNumber: string): string {
    const handoff = this.buildWhatsAppHandoff(orderNumber);
    const replyTo = (process.env.ZEPTOMAIL_REPLY_TO || '').trim();

    if (handoff) {
      return `
    <!-- Technical & Operational support banner -->
    <tr>
      <td style="padding: 24px 32px; background-color: #FCFAF2; border-top: 1px solid #F7F3E1; text-align: center;">
        <h3 style="margin: 0 0 6px 0; font-family: sans-serif; font-size: 13px; font-weight: 800; color: #8A6D1C; text-transform: uppercase; letter-spacing: 0.05em;">Need help with your order?</h3>
        <p style="margin: 0; font-family: sans-serif; font-size: 12px; line-height: 1.5; color: #5C4B18;">
          A person at GoldPlus answers on WhatsApp in shop hours. Or call ${this.escapeHtml(supportPhoneDisplay())}.<br>
          <a href="${handoff.url}" target="_blank" style="display: inline-block; margin-top: 8px; color: #0A0A0A; text-decoration: none; font-weight: 900; background-color: #96cc06; padding: 6px 14px; border-radius: 4px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em;">
            Ask us on WhatsApp
          </a>
        </p>
      </td>
    </tr>`;
    }

    const supportContactMsg = replyTo 
      ? `Call ${this.escapeHtml(supportPhoneDisplay())}, or reply to this email.`
      : `Call ${this.escapeHtml(supportPhoneDisplay())} and we will help.`;

    return `
    <!-- Technical & Operational support banner -->
    <tr>
      <td style="padding: 24px 32px; background-color: #FCFAF2; border-top: 1px solid #F7F3E1; text-align: center;">
        <h3 style="margin: 0 0 6px 0; font-family: sans-serif; font-size: 13px; font-weight: 800; color: #8A6D1C; text-transform: uppercase; letter-spacing: 0.05em;">Need help with your order?</h3>
        <p style="margin: 0; font-family: sans-serif; font-size: 12px; line-height: 1.5; color: #5C4B18;">
          ${supportContactMsg}
        </p>
      </td>
    </tr>`;
  }

  /**
   * Renders the billing note and footer legal limits
   */
  private renderEmailFooter(): string {
    return `
    <!-- Transaction disclaimer footer -->
    <tr>
      <td style="background-color: #0A0A0A; padding: 32px 24px; text-align: center; border-top: 1px solid #1A1A1A;">
        <p style="margin: 0 0 12px 0; font-family: sans-serif; font-size: 11px; line-height: 1.6; color: #9CA3AF;">
          We sent this because of an order or request you made with GoldPlus. It is not marketing, so there is nothing to unsubscribe from.
        </p>
        <p style="margin: 0; font-family: sans-serif; font-size: 10px; font-weight: bold; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em;">
          &copy; ${new Date().getFullYear()} GoldPlus. Wilson Road, Kampala.
        </p>
      </td>
    </tr>`;
  }

  /**
   * Complete high-fidelity HTML email receipt composition
   */
  public renderEmail(template: NotificationTemplateKey, order: any): string {
    const formattedTotal = this.formatUgx(order.totalUgx || order.subtotalUgx || 0);
    const dateStr = order.createdAt
      ? new Date(order.createdAt).toLocaleDateString('en-GB')
      : new Date().toLocaleDateString('en-GB');

    const subject = this.getSubject(template);
    const preheader = this.getPreheader(template);
    const headline = this.getHeadline(template);
    const message = this.getStatusMessage(template, order.orderNumber, Number(order.totalUgx || order.subtotalUgx || 0));

    const isSuccess = ['ORDER_PAYMENT_SUCCESS', 'ORDER_FULFILLMENT_COMPLETED'].includes(template);

    const preheaderHtml = this.renderPreheader(preheader);
    const headerHtml = this.renderEmailHeader();
    const statusHtml = this.renderStatusBlock(headline, message, isSuccess, order.customerName);
    const summaryHtml = this.renderOrderSummary(order, formattedTotal, dateStr);
    const itemsHtml = this.renderLineItemsTable(order.items || []);
    const totalsHtml = this.renderTotalBlock(formattedTotal);
    const ctaHtml = this.renderPrimaryCta(template, order.orderNumber);
    const supportHtml = this.renderSupportBlock(order.orderNumber);
    const footerHtml = this.renderEmailFooter();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F5F7F2; -webkit-font-smoothing: antialiased; -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%;">
  ${preheaderHtml}
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F5F7F2; padding: 40px 16px;">
    <tr>
      <td align="center">
        <!-- Main centered container card -->
        <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 12px; overflow: hidden; max-width: 600px; width: 100%;">
          ${headerHtml}
          ${statusHtml}
          ${summaryHtml}
          ${itemsHtml}
          ${totalsHtml}
          ${ctaHtml}
          ${supportHtml}
          ${footerHtml}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  /**
   * Renders the plain-text fallback representation
   */
  public renderTextBody(template: NotificationTemplateKey, order: any): string {
    const formattedTotal = this.formatUgx(order.totalUgx || order.subtotalUgx || 0);
    const dateStr = order.createdAt
      ? new Date(order.createdAt).toLocaleDateString('en-GB')
      : new Date().toLocaleDateString('en-GB');

    const subject = this.getSubject(template);
    const headline = this.getHeadline(template);
    const message = (emailCopy(template, { orderNumber: order.orderNumber, totalUgx: Number(order.totalUgx || order.subtotalUgx || 0) })?.body
      ?? `There is an update on your order ${order.orderNumber}.`);

    const trackUrl = trackOrderUrl(order.orderNumber);
    const first = String(order.customerName || '').trim().split(/\s+/)[0];

    let itemsText = '';
    if (order.items && order.items.length > 0) {
      itemsText = 'What you ordered\n' + order.items.map((item: any) => {
        const name = item.productName || item.name;
        const qty = item.quantity;
        const subtotal = this.formatUgx((item.unitPrice || item.price || 0) * qty);
        return `${qty} x ${name}: ${subtotal}`;
      }).join('\n') + '\n\n';
    }

    const handoff = this.buildWhatsAppHandoff(order.orderNumber);
    const helpLine = handoff
      ? `Need help? Call ${supportPhoneDisplay()} or WhatsApp us: ${handoff.url}`
      : `Need help? Call ${supportPhoneDisplay()}.`;

    return `${first ? `Hello ${first},` : 'Hello,'}

${headline}

${message}

Order ${order.orderNumber}
Placed: ${dateStr}
Status: ${this.orderStatusWords(order.orderStatus)}
Payment: ${this.paymentStatusWords(order.paymentStatus)}
Delivering to: ${order.deliveryArea || 'to be confirmed with you'}
Total: ${formattedTotal}

${itemsText}Track this order: ${trackUrl}

${helpLine}

GoldPlus, Wilson Road, Kampala
You are getting this because of order ${order.orderNumber}.`;
  }

  /** Plain words for an order status. Never the enum. */
  private orderStatusWords(status: unknown): string {
    const s = String(status ?? '').toLowerCase();
    const map: Record<string, string> = {
      received: 'Received', pending_payment: 'Waiting for payment', paid: 'Paid', payment_failed: 'Payment did not go through',
      pending_owner_review: 'Being checked by our team', processing: 'Being packed', dispatched: 'On its way', shipped: 'On its way',
      delivery_failed: 'Delivery not completed', delivered: 'Delivered', completed: 'Delivered', cancelled: 'Cancelled', failed: 'Could not be completed',
    };
    return map[s] ?? 'In progress';
  }

  /** Plain words for a payment status. Never the enum. */
  private paymentStatusWords(status: unknown): string {
    const s = String(status ?? '').toLowerCase();
    const map: Record<string, string> = {
      unpaid: 'Not paid yet', pending: 'Not cleared yet', paid: 'Paid', failed: 'Did not go through',
    };
    return map[s] ?? 'Being checked';
  }

  /**
   * A customer email that is not an order receipt: password reset, loyalty,
   * acknowledgements. Same header and footer, one message, one button.
   */
  public renderCustomerEmail(copy: EmailCopy, customerName?: string | null): string {
    const first = String(customerName || '').trim().split(/\s+/)[0];
    const greeting = first ? `Hello ${this.escapeHtml(first)},` : 'Hello,';
    const tone = copy.tone === 'success' ? { bg: '#F3FBF2', border: '#E1F3DF', color: '#2B6A25' }
      : copy.tone === 'wait' ? { bg: '#FCFAF2', border: '#F7F3E1', color: '#8A6D1C' }
      : { bg: '#F8FAFC', border: '#E2E8F0', color: '#0A0A0A' };
    const ctaHtml = copy.cta ? `
    <tr>
      <td style="padding: 0 32px 32px 32px; background-color: #FFFFFF; text-align: center;">
        <a href="${this.escapeHtml(copy.cta.url)}" target="_blank" style="display: inline-block; padding: 14px 32px; font-family: sans-serif; font-size: 13px; font-weight: 900; color: #0A0A0A; text-decoration: none; text-transform: uppercase; letter-spacing: 0.05em; background-color: #96cc06; border-radius: 6px;">${this.escapeHtml(copy.cta.label)}</a>
        <p style="padding-top: 16px; margin: 0; font-family: sans-serif; font-size: 10px; color: #9CA3AF; line-height: 1.4;">If the button does not work, copy this link into your browser:<br><a href="${this.escapeHtml(copy.cta.url)}" style="color: #96cc06; font-weight: bold; word-break: break-all;">${this.escapeHtml(copy.cta.url)}</a></p>
      </td>
    </tr>` : '';
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${this.escapeHtml(copy.subject)}</title></head>
<body style="margin: 0; padding: 0; background-color: #F5F7F2;">
  ${this.renderPreheader(copy.preheader)}
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F5F7F2; padding: 40px 16px;">
    <tr><td align="center">
      <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 12px; overflow: hidden; max-width: 600px; width: 100%;">
        ${this.renderEmailHeader()}
        <tr>
          <td style="padding: 32px 32px 24px 32px; background-color: #FFFFFF;">
            <div style="background-color: ${tone.bg}; border: 1px solid ${tone.border}; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px;">
              <h2 style="margin: 0; font-family: sans-serif; font-size: 15px; font-weight: 800; color: ${tone.color};">${this.escapeHtml(copy.headline)}</h2>
            </div>
            <p style="margin: 0 0 12px 0; font-family: sans-serif; font-size: 14px; font-weight: bold; color: #0A0A0A;">${greeting}</p>
            <p style="margin: 0; font-family: sans-serif; font-size: 14px; line-height: 1.6; color: #374151;">${this.escapeHtml(copy.body)}</p>
          </td>
        </tr>
        ${ctaHtml}
        ${this.renderEmailFooter()}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  /** Plain text twin of renderCustomerEmail. */
  public renderCustomerText(copy: EmailCopy, customerName?: string | null): string {
    const first = String(customerName || '').trim().split(/\s+/)[0];
    return `${first ? `Hello ${first},` : 'Hello,'}\n\n${copy.headline}\n\n${copy.body}\n\n${copy.cta ? `${copy.cta.label}: ${copy.cta.url}\n\n` : ''}Need help? Call ${supportPhoneDisplay()}.\n\nGoldPlus, Wilson Road, Kampala`;
  }

  /**
   * Pre-existing WhatsApp build route
   */
  public renderWhatsApp(order: any): string {
    const status = String(order.orderStatus ?? '').toLowerCase();
    const paymentStatus = String(order.paymentStatus ?? '').toLowerCase();
    const template: NotificationTemplateKey | 'ORDER_DISPATCHED' | 'ORDER_CANCELLED_BY_SHOP' =
      status === 'cancelled' ? 'ORDER_CANCELLED_BY_SHOP'
      : status === 'failed' || paymentStatus === 'failed' ? 'ORDER_PAYMENT_FAILED'
      : status === 'pending_payment' || paymentStatus === 'pending' ? 'ORDER_PAYMENT_PENDING'
      : ['delivered', 'completed'].includes(status) ? 'ORDER_FULFILLMENT_COMPLETED'
      : status === 'dispatched' ? 'ORDER_DISPATCHED'
      : status === 'processing' && paymentStatus === 'paid' ? 'ORDER_FULFILLMENT_PROCESSING'
      : paymentStatus === 'paid' ? 'ORDER_PAYMENT_SUCCESS'
      : 'ORDER_RECEIVED_UNPAID';
    return (
      whatsappText(template, { customerName: order.customerName, orderNumber: order.orderNumber, totalUgx: Number(order.totalUgx || 0) })
      ?? `Hello,\n\nThere is an update on your GoldPlus order ${order.orderNumber}. Track it here: ${trackOrderUrl(order.orderNumber)}`
    );
  }
}
