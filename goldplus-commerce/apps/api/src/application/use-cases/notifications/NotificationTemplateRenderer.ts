import { Order } from '../../../domain/commerce/Order';

export type NotificationTemplateKey =
  | 'ORDER_RECEIVED_UNPAID'
  | 'ORDER_PAYMENT_PENDING'
  | 'ORDER_PAYMENT_SUCCESS'
  | 'ORDER_PAYMENT_FAILED'
  | 'ORDER_PAYMENT_CANCELLED'
  | 'ORDER_FULFILLMENT_PROCESSING'
  | 'ORDER_FULFILLMENT_COMPLETED';

export class NotificationTemplateRenderer {
  private formatUgx(amount: number): string {
    return new Intl.NumberFormat('en-UG', {
      style: 'currency',
      currency: 'UGX',
      maximumFractionDigits: 0,
    }).format(amount);
  }

  public renderEmail(template: NotificationTemplateKey, order: any): string {
    const formattedTotal = this.formatUgx(order.totalUgx || order.subtotalUgx || 0);
    const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB');

    let title = 'Order Notification';
    let headline = 'Order Update';
    let statusMessage = '';
    let isSuccessBanner = false;

    switch (template) {
      case 'ORDER_RECEIVED_UNPAID':
        title = 'GoldPlus - Order Received';
        headline = 'Order Received & Awaiting Payment';
        statusMessage = `Thank you for your order. We have successfully received order number <strong>${order.orderNumber}</strong>. Please proceed with payment via your Mobile Money checkout screen or follow PesaPal payment links to complete your purchase.`;
        break;
      case 'ORDER_PAYMENT_PENDING':
        title = 'GoldPlus - Payment Pending';
        headline = 'Payment Verification Pending';
        statusMessage = `We have recorded a pending payment attempt for order <strong>${order.orderNumber}</strong>. Our systems are currently verifying transaction status. No further action is required.`;
        break;
      case 'ORDER_PAYMENT_SUCCESS':
        title = 'GoldPlus - Order Confirmed';
        headline = 'Payment Confirmed & Order Processing';
        statusMessage = `Excellent news! Payment of <strong>${formattedTotal}</strong> has been successfully verified. Your order <strong>${order.orderNumber}</strong> is now officially confirmed and transitioning to hardware dispatch logistics.`;
        isSuccessBanner = true;
        break;
      case 'ORDER_PAYMENT_FAILED':
        title = 'GoldPlus - Payment Failed';
        headline = 'Payment Attempt Unsuccessful';
        statusMessage = `We could not verify payment for order <strong>${order.orderNumber}</strong>. Please check your Mobile Money network or click checkout again to retry.`;
        break;
      case 'ORDER_PAYMENT_CANCELLED':
        title = 'GoldPlus - Checkout Cancelled';
        headline = 'Payment Attempt Cancelled';
        statusMessage = `The payment checkout flow for order <strong>${order.orderNumber}</strong> was cancelled. You can retry checkout anytime from your order tracking screen.`;
        break;
      case 'ORDER_FULFILLMENT_PROCESSING':
        title = 'GoldPlus - Order in Processing';
        headline = 'Logistics & Packaging in Progress';
        statusMessage = `Your order <strong>${order.orderNumber}</strong> is currently being packaged and optimized for transport in Kampala. You will be notified as soon as it is shipped.`;
        break;
      case 'ORDER_FULFILLMENT_COMPLETED':
        title = 'GoldPlus - Delivery Completed';
        headline = 'Delivery Confirmed & Settled';
        statusMessage = `Congratulations! Order <strong>${order.orderNumber}</strong> has been delivered successfully. Thank you for choosing GoldPlus.`;
        isSuccessBanner = true;
        break;
      default:
        statusMessage = `Order number ${order.orderNumber} status has updated to: ${order.orderStatus}.`;
    }

    const itemsHtml = (order.items || [])
      .map(
        (item: any) => `
      <tr>
        <td style="padding: 12px; font-weight: bold; color: #111827; border-bottom: 1px solid #f3f4f6;">${item.productName || item.name}</td>
        <td style="padding: 12px; text-align: center; font-family: monospace; color: #6b7280; border-bottom: 1px solid #f3f4f6;">${item.sku || 'N/A'}</td>
        <td style="padding: 12px; text-align: center; font-weight: bold; color: #374151; border-bottom: 1px solid #f3f4f6;">${item.quantity}</td>
        <td style="padding: 12px; text-align: right; color: #4b5563; border-bottom: 1px solid #f3f4f6;">${this.formatUgx(item.unitPrice || item.price)}</td>
        <td style="padding: 12px; text-align: right; font-weight: 800; color: #111827; border-bottom: 1px solid #f3f4f6;">${this.formatUgx((item.unitPrice || item.price) * item.quantity)}</td>
      </tr>`
      )
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
          <!-- Header Banner -->
          <tr>
            <td style="background-color: #111827; padding: 32px; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 900; color: #f59e0b; letter-spacing: -0.025em; text-transform: uppercase;">GoldPlus</h1>
              <p style="margin: 4px 0 0 0; font-size: 11px; font-weight: bold; color: #9ca3af; letter-spacing: 0.05em; text-transform: uppercase;">Premium Solar & Hardware Commerce</p>
            </td>
          </tr>
          
          <!-- Status Headline Banner -->
          <tr>
            <td style="background-color: ${isSuccessBanner ? '#ecfdf5' : '#fef3c7'}; padding: 20px 32px; border-bottom: 1px solid ${isSuccessBanner ? '#d1fae5' : '#fde68a'};">
              <h2 style="margin: 0; font-size: 16px; font-weight: 900; color: ${isSuccessBanner ? '#065f46' : '#92400e'}; letter-spacing: -0.01em;">${headline}</h2>
            </td>
          </tr>

          <!-- Message Body -->
          <tr>
            <td style="padding: 32px 32px 24px 32px; font-size: 14px; line-height: 1.6; color: #374151;">
              <p style="margin: 0 0 20px 0;">Dear ${order.customerName || 'Customer'},</p>
              <p style="margin: 0 0 20px 0;">${statusMessage}</p>
              <div style="background-color: #f3f4f6; border-radius: 12px; padding: 16px; margin: 24px 0;">
                <table width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size: 12px;">
                  <tr>
                    <td style="padding: 4px 0; color: #6b7280; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em;">Order Reference</td>
                    <td style="padding: 4px 0; text-align: right; font-weight: bold; color: #111827; font-family: monospace;">${order.orderNumber}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #6b7280; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em;">Date Placed</td>
                    <td style="padding: 4px 0; text-align: right; color: #111827;">${dateStr}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #6b7280; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em;">Fulfillment Status</td>
                    <td style="padding: 4px 0; text-align: right; font-weight: 800; color: #f59e0b; text-transform: uppercase;">${order.orderStatus.replace(/_/g, ' ')}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #6b7280; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em;">Payment Status</td>
                    <td style="padding: 4px 0; text-align: right; font-weight: 800; color: ${order.paymentStatus === 'paid' ? '#10b981' : '#f59e0b'}; text-transform: uppercase;">${order.paymentStatus}</td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>

          <!-- Items Table -->
          <tr>
            <td style="padding: 0 32px 24px 32px;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size: 13px; border-collapse: collapse;">
                <thead>
                  <tr style="background-color: #f9fafb; font-weight: bold; text-transform: uppercase; font-size: 10px; color: #9ca3af; letter-spacing: 0.05em; border-bottom: 2px solid #e5e7eb;">
                    <th style="padding: 8px 12px; text-align: left;">Product</th>
                    <th style="padding: 8px 12px; text-align: center;">SKU</th>
                    <th style="padding: 8px 12px; text-align: center;">Qty</th>
                    <th style="padding: 8px 12px; text-align: right;">Unit Price</th>
                    <th style="padding: 8px 12px; text-align: right;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Total Summary -->
          <tr>
            <td style="padding: 0 32px 32px 32px;">
              <table align="right" width="240" border="0" cellspacing="0" cellpadding="0" style="font-size: 13px;">
                <tr>
                  <td style="padding: 6px 0; color: #6b7280;">Subtotal</td>
                  <td style="padding: 6px 0; text-align: right; font-weight: bold; color: #111827;">${formattedTotal}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #6b7280;">Delivery Zone Fee</td>
                  <td style="padding: 6px 0; text-align: right; font-style: italic; color: #9ca3af;">Calculated post-zone</td>
                </tr>
                <tr style="border-top: 1px solid #e5e7eb;">
                  <td style="padding: 12px 0 0 0; font-size: 14px; font-weight: 900; color: #111827;">Grand Total</td>
                  <td style="padding: 12px 0 0 0; font-size: 16px; font-weight: 900; color: #111827; text-align: right;">${formattedTotal}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Support & Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 32px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 11px; color: #9ca3af;">
              <p style="margin: 0 0 12px 0; line-height: 1.5;">This email is an automated transactional notification regarding your active order on GoldPlus. Real-time encryption secures your personal data and delivery destination details.</p>
              <p style="margin: 0; font-weight: bold; color: #6b7280;">Need instant support? Inquire directly via <a href="https://wa.me/256000000000?text=Hello%20GoldPlus,%20I'm%20inquiring%20about%20order%20${encodeURIComponent(order.orderNumber)}" style="color: #f59e0b; text-decoration: none; font-weight: 900;">WhatsApp Support</a>.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  public renderWhatsApp(order: any): string {
    const status = order.orderStatus;
    const paymentStatus = order.paymentStatus;

    let greeting = `Hello ${order.customerName || 'Customer'}`;
    let baseText = `${greeting}, regarding your GoldPlus order *${order.orderNumber}*:\n\n`;

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
        `Once verified by PesaPal networks, our transport teams in Kampala will package your hardware.\n\n` +
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
          `Thank you for choosing GoldPlus solar hardware!`
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
