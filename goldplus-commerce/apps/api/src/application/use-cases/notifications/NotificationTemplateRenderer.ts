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
    const formatted = new Intl.NumberFormat('en-US', {
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
    switch (template) {
      case 'ORDER_RECEIVED_UNPAID':
        return 'We received your GoldPlus order';
      case 'ORDER_PAYMENT_PENDING':
        return 'Your GoldPlus payment is being checked';
      case 'ORDER_PAYMENT_SUCCESS':
        return 'Payment received for your GoldPlus order';
      case 'ORDER_PAYMENT_FAILED':
        return 'Your GoldPlus payment did not go through';
      case 'ORDER_PAYMENT_CANCELLED':
        return 'Your GoldPlus checkout was cancelled';
      case 'ORDER_FULFILLMENT_PROCESSING':
        return 'Your GoldPlus order is being prepared';
      case 'ORDER_FULFILLMENT_COMPLETED':
        return 'Your GoldPlus order is complete';
      default:
        return 'GoldPlus Transaction Update';
    }
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
    switch (template) {
      case 'ORDER_RECEIVED_UNPAID':
        return 'Complete payment to move your order forward.';
      case 'ORDER_PAYMENT_PENDING':
        return 'We are waiting for payment confirmation.';
      case 'ORDER_PAYMENT_SUCCESS':
        return 'Your payment has been verified.';
      case 'ORDER_PAYMENT_FAILED':
        return 'You can retry payment or contact support.';
      case 'ORDER_PAYMENT_CANCELLED':
        return 'Your order has not been paid.';
      case 'ORDER_FULFILLMENT_PROCESSING':
        return 'We are preparing your items.';
      case 'ORDER_FULFILLMENT_COMPLETED':
        return 'Your order has been completed.';
      default:
        return 'Important update regarding your recent transaction.';
    }
  }

  /**
   * Safe headline text mapping according to template type
   */
  private getHeadline(template: NotificationTemplateKey): string {
    const override = overrideProvider?.(template)?.headline;
    if (override) return override;
    switch (template) {
      case 'ORDER_RECEIVED_UNPAID':
        return 'Order received. Payment is still pending.';
      case 'ORDER_PAYMENT_PENDING':
        return 'Payment pending verification.';
      case 'ORDER_PAYMENT_SUCCESS':
        return 'Payment verified. We’ll prepare your order.';
      case 'ORDER_PAYMENT_FAILED':
        return 'Payment was not completed.';
      case 'ORDER_PAYMENT_CANCELLED':
        return 'Checkout cancelled. Your order has not been paid.';
      case 'ORDER_FULFILLMENT_PROCESSING':
        return 'Your order is being prepared.';
      case 'ORDER_FULFILLMENT_COMPLETED':
        return 'Your order is complete.';
      default:
        return 'Order Status Updated';
    }
  }

  /**
   * Safe long status message mapping according to template type
   */
  private getStatusMessage(template: NotificationTemplateKey, orderNumber: string, formattedTotal: string): string {
    const escapedRef = this.escapeHtml(orderNumber);
    switch (template) {
      case 'ORDER_RECEIVED_UNPAID':
        return `Thank you for your order. We have saved order <strong>${escapedRef}</strong>. Complete payment when ready so our team can prepare it.`;
      case 'ORDER_PAYMENT_PENDING':
        return `We have received your payment attempt for order <strong>${escapedRef}</strong> and are checking its status. You can track the order anytime.`;
      case 'ORDER_PAYMENT_SUCCESS':
        return `Your payment has been verified. Our team will now prepare your GoldPlus order <strong>${escapedRef}</strong>.`;
      case 'ORDER_PAYMENT_FAILED':
        return `Your payment did not go through. You can retry checkout or contact support for help.`;
      case 'ORDER_PAYMENT_CANCELLED':
        return `Your checkout was cancelled before payment was completed. You can return to checkout when ready.`;
      case 'ORDER_FULFILLMENT_PROCESSING':
        return `Our team is preparing your GoldPlus order <strong>${escapedRef}</strong>. You can track it anytime.`;
      case 'ORDER_FULFILLMENT_COMPLETED':
        return `Your GoldPlus order <strong>${escapedRef}</strong> has been completed. Contact support if you need help.`;
      default:
        return `Your order number ${escapedRef} has transitioned to a new fulfillment stage.`;
    }
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
        <p style="margin: 4px 0 0 0; font-family: sans-serif; font-size: 10px; font-weight: 800; color: #9CA3AF; letter-spacing: 0.1em; text-transform: uppercase;">Official GoldPlus Online Store</p>
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
    
    const escapedName = this.escapeHtml(customerName || 'Customer');
    const greetingHtml = `<p style="margin: 0 0 12px 0; font-family: sans-serif; font-size: 14px; font-weight: bold; color: #0A0A0A;">Dear ${escapedName},</p>`;

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
    const escapedArea = this.escapeHtml(order.deliveryArea || 'N/A');
    const escapedStatus = this.escapeHtml(order.orderStatus.replace(/_/g, ' '));
    const escapedPayment = this.escapeHtml(order.paymentStatus);

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
              <td style="padding: 4px 0; color: #6B7280; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">Fulfillment Status</td>
              <td style="padding: 4px 0; text-align: right; font-weight: bold; color: #0A0A0A; text-transform: uppercase;">${escapedStatus}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #6B7280; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">Payment Status</td>
              <td style="padding: 4px 0; text-align: right; font-weight: bold; color: ${payColor}; text-transform: uppercase;">${escapedPayment}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #6B7280; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">Delivery Destination</td>
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
        const sku = this.escapeHtml(item.sku || 'N/A');
        const qty = item.quantity;
        const price = item.unitPrice || item.price || 0;
        const total = price * qty;

        return `
        <tr>
          <td style="padding: 12px 8px; font-family: sans-serif; font-size: 13px; font-weight: bold; color: #0A0A0A; border-bottom: 1px solid #E5E7EB; text-align: left;">
            ${name}
            <div style="font-size: 10px; font-weight: normal; color: #6B7280; margin-top: 2px;">SKU: ${sku}</div>
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
            <td style="padding: 12px 0 0 0; font-size: 14px; font-weight: bold; color: #0A0A0A; text-align: left;">Grand Total</td>
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
    const trackUrl = `https://shopgoldplus.com/track-order?ref=${encodeURIComponent(orderNumber)}`;
    let ctaLabel = 'Track Order';

    switch (template) {
      case 'ORDER_RECEIVED_UNPAID':
        ctaLabel = 'Complete Payment';
        break;
      case 'ORDER_PAYMENT_PENDING':
      case 'ORDER_PAYMENT_SUCCESS':
      case 'ORDER_FULFILLMENT_PROCESSING':
        ctaLabel = 'Track Order';
        break;
      case 'ORDER_PAYMENT_FAILED':
        ctaLabel = 'Retry Payment';
        break;
      case 'ORDER_PAYMENT_CANCELLED':
        ctaLabel = 'Return to Checkout';
        break;
      case 'ORDER_FULFILLMENT_COMPLETED':
        ctaLabel = 'View Order';
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
              If the button does not work, copy and paste this URL into your browser:<br>
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
          Connect directly with our central desk for payment or logistical guidance.<br>
          <a href="${handoff.url}" target="_blank" style="display: inline-block; margin-top: 8px; color: #0A0A0A; text-decoration: none; font-weight: 900; background-color: #96cc06; padding: 6px 14px; border-radius: 4px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em;">
            Chat with GoldPlus Support &rarr;
          </a>
        </p>
      </td>
    </tr>`;
    }

    const supportContactMsg = replyTo 
      ? `Reach our support desk at <a href="mailto:${replyTo}" style="color: #8A6D1C; font-weight: bold; text-decoration: underline;">${replyTo}</a> for payment or logistical guidance.`
      : `Contact GoldPlus Support via your dashboard or order tracking page for logistical guidance.`;

    return `
    <!-- Technical & Operational support banner -->
    <tr>
      <td style="padding: 24px 32px; background-color: #FCFAF2; border-top: 1px solid #F7F3E1; text-align: center;">
        <h3 style="margin: 0 0 6px 0; font-family: sans-serif; font-size: 13px; font-weight: 800; color: #8A6D1C; text-transform: uppercase; letter-spacing: 0.05em;">Contact GoldPlus Support</h3>
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
          This email is an automated billing transaction notification regarding your active customer account on the GoldPlus E-commerce network. Unsubscribe links are not legally applicable as this message does not consist of promotional content.
        </p>
        <p style="margin: 0; font-family: sans-serif; font-size: 10px; font-weight: bold; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em;">
          &copy; ${new Date().getFullYear()} GoldPlus Online Store. Kampala, Uganda.
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
    const message = this.getStatusMessage(template, order.orderNumber, formattedTotal);

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
    const message = this.getStatusMessage(template, order.orderNumber, formattedTotal)
      .replace(/<strong[^>]*>/g, '')
      .replace(/<\/strong>/g, '')
      .replace(/<a[^>]*>/g, '')
      .replace(/<\/a>/g, '');

    const trackUrl = `https://shopgoldplus.com/track-order?ref=${order.orderNumber}`;

    let itemsText = '';
    if (order.items && order.items.length > 0) {
      itemsText = 'Purchased Items:\n' + order.items.map((item: any) => {
        const name = item.productName || item.name;
        const sku = item.sku || 'N/A';
        const qty = item.quantity;
        const price = this.formatUgx(item.unitPrice || item.price || 0);
        const subtotal = this.formatUgx((item.unitPrice || item.price || 0) * qty);
        return `- ${name} (${sku}) x${qty} @ ${price} (Total: ${subtotal})`;
      }).join('\n') + '\n\n';
    }

    return `Dear ${order.customerName || 'Customer'},

--- ${headline.toUpperCase()} ---

${message}

=== ORDER SUMMARY ===
Order Reference: ${order.orderNumber}
Date Placed: ${dateStr}
Fulfillment Status: ${order.orderStatus.replace(/_/g, ' ').toUpperCase()}
Payment Status: ${order.paymentStatus.toUpperCase()}
Delivery Destination: ${order.deliveryArea || 'N/A'}
Grand Total: ${formattedTotal}

${itemsText}=== ACTION REQUIRED ===
Track your delivery live:
${trackUrl}

${this.buildWhatsAppHandoff(order.orderNumber)
  ? `=== NEED SUPPORT? ===\nWhatsApp Support:\n${this.buildWhatsAppHandoff(order.orderNumber)?.url}`
  : `=== NEED SUPPORT? ===\nWhatsApp support: not configured.`}

GoldPlus Online Store
Kampala, Uganda
(This is an automated transaction message regarding order ${order.orderNumber})`;
  }

  /**
   * Pre-existing WhatsApp build route
   */
  public renderWhatsApp(order: any): string {
    const status = order.orderStatus;
    const paymentStatus = order.paymentStatus;

    const greeting = `Hello ${order.customerName || 'Customer'}`;
    const baseText = `${greeting}, regarding your GoldPlus order *${order.orderNumber}*:\n\n`;

    if (status === 'received' && paymentStatus === 'unpaid') {
      return (
        baseText +
        `We have received your order! Placed status is currently *Awaiting Payment*.\n\n` +
        `Total Amount: *${this.formatUgx(order.totalUgx || 0)}*\n\n` +
        `To complete your checkout securely, please review your Mobile Money window or use our tracking URL: https://shopgoldplus.com/track-order?ref=${order.orderNumber}`
      );
    } else if (status === 'pending_payment') {
      return (
        baseText +
        `Your Mobile Money checkout has been initiated and is *Pending verification*.\n\n` +
        `Once verified, our team will prepare your GoldPlus order.\n\n` +
        `Track status live: https://shopgoldplus.com/track-order?ref=${order.orderNumber}`
      );
    } else if (paymentStatus === 'paid') {
      if (status === 'processing') {
        return (
          baseText +
          `Excellent news! Your payment has been *Successfully Verified*.\n\n` +
          `Fulfillment is in progress, and logistics coordinates are actively being routed.\n\n` +
          `Track delivery live: https://shopgoldplus.com/track-order?ref=${order.orderNumber}`
        );
      } else if (status === 'completed') {
        return (
          baseText +
          `Your order has been *Delivered and Settled* successfully.\n\n` +
          `Thank you for choosing GoldPlus Online Store!`
        );
      }
    } else if (status === 'cancelled') {
      return (
        baseText +
        `Your order has been *Cancelled*.\n\n` +
        `If you believe this was an error or would like to rebuild your cart, chat with us here.`
      );
    } else if (status === 'failed') {
      return (
        baseText +
        `Your payment or checkout verification has *Failed*.\n\n` +
        `You can safely retry checkout or review payment details using your tracking link: https://shopgoldplus.com/track-order?ref=${order.orderNumber}`
      );
    }

    return (
      baseText +
      `Your order fulfillment status has been updated to *${status.replace(/_/g, ' ')}*.\n\n` +
      `Track status live: https://shopgoldplus.com/track-order?ref=${order.orderNumber}`
    );
  }
}
