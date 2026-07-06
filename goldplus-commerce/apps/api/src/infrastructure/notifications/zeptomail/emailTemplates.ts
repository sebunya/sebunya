/**
 * Transactional email templates for ZeptoMail.
 *
 * Each template maps a notification template key to a subject and a
 * simple, responsive, branded HTML body. Only facts present in the
 * payload are rendered — no invented details.
 */

export interface RenderedEmail {
  subject: string;
  htmlBody: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background:#b45309;padding:20px 28px;">
                <span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:0.5px;">GoldPlus</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h1 style="margin:0 0 16px;font-size:18px;color:#1c1917;">${escapeHtml(title)}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;background:#fafaf9;border-top:1px solid #e7e5e4;">
                <p style="margin:0;font-size:12px;color:#78716c;">
                  This is a transactional notification from GoldPlus. If you believe you received it in error, please contact support.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function detailRow(label: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  return `<tr>
    <td style="padding:6px 12px;font-size:13px;color:#78716c;">${escapeHtml(label)}</td>
    <td style="padding:6px 12px;font-size:13px;color:#1c1917;font-weight:bold;">${escapeHtml(value)}</td>
  </tr>`;
}

function detailsTable(rows: string): string {
  if (!rows) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#fafaf9;border-radius:6px;margin:12px 0;">${rows}</table>`;
}

export function renderEmail(template: string, data: Record<string, unknown>): RenderedEmail {
  switch (template) {
    case 'PAYMENT_SUCCESS':
      return {
        subject: 'GoldPlus — payment received',
        htmlBody: layout(
          'Payment received',
          `<p style="font-size:14px;line-height:1.6;">A payment was recorded successfully.</p>
           ${detailsTable(detailRow('Payment ID', data.paymentId) + detailRow('Order', data.orderId))}`,
        ),
      };

    case 'PAYMENT_FAILED':
      return {
        subject: 'GoldPlus — payment failed',
        htmlBody: layout(
          'Payment failed',
          `<p style="font-size:14px;line-height:1.6;">A payment attempt failed and may need follow-up.</p>
           ${detailsTable(detailRow('Payment ID', data.paymentId) + detailRow('Order', data.orderId))}`,
        ),
      };

    case 'DEALER_APPLICATION':
      return {
        subject: 'GoldPlus — new dealer application',
        htmlBody: layout(
          'New dealer application',
          `<p style="font-size:14px;line-height:1.6;">A new dealer application was submitted and is awaiting review.</p>
           ${detailsTable(detailRow('Application ID', data.applicationId))}`,
        ),
      };

    case 'NEW_QUOTE_REQUEST':
      return {
        subject: 'GoldPlus — new quote request',
        htmlBody: layout(
          'New quote request',
          `<p style="font-size:14px;line-height:1.6;">A customer requested a quote.</p>
           ${detailsTable(detailRow('Quote ID', data.quoteId))}`,
        ),
      };

    case 'WELCOME':
      return {
        subject: 'Welcome to GoldPlus',
        htmlBody: layout(
          'Welcome to GoldPlus',
          `<p style="font-size:14px;line-height:1.6;">Your GoldPlus account is ready.</p>
           <p style="font-size:14px;line-height:1.6;">You can browse the shop, track your orders, and earn loyalty points on every paid order — 1 point for every 1,000 UGX.</p>
           <p style="font-size:14px;line-height:1.6;">If you did not create this account, please contact support immediately.</p>`,
        ),
      };

    case 'FAKE_REPORT_ALERT':
      return {
        subject: 'GoldPlus — counterfeit product report',
        htmlBody: layout(
          'Counterfeit product report',
          `<p style="font-size:14px;line-height:1.6;">A visitor reported a suspected counterfeit product. Please investigate.</p>
           ${detailsTable(detailRow('Report ID', data.reportId))}`,
        ),
      };

    default: {
      // Unknown template keys still send a well-formed generic email so
      // an unmapped event never silently drops its payload.
      const rows = Object.entries(data)
        .map(([k, v]) => detailRow(k, v))
        .join('');
      return {
        subject: `GoldPlus — notification (${template})`,
        htmlBody: layout(`Notification: ${template}`, detailsTable(rows) || '<p style="font-size:14px;">No details provided.</p>'),
      };
    }
  }
}
