/**
 * Renders every email this shop can send into standalone .html files.
 *
 * Written for ZeptoMail's account review: they ask to see the mail a sender
 * actually sends. Re-run it whenever wording changes so what is submitted is
 * what customers receive — a sample deck that has drifted from the code is
 * worse than none.
 *
 *   npx tsx apps/api/src/scripts/export-email-templates.ts [outDir]
 *
 * Sample data only: no customer's name, address, phone or order is read from
 * the database, so the output is safe to send to a third party.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { NotificationTemplateRenderer, NOTIFICATION_TEMPLATE_KEYS } from '../application/use-cases/notifications/NotificationTemplateRenderer';
import { emailCopy, CUSTOMER_TRANSACTIONAL_TEMPLATES } from '../application/notifications/CustomerMessages';
import { renderAdminOrderEmail } from '../domain/notifications/AdminOrderEmail';

const outDir = process.argv[2] || 'email-templates';
mkdirSync(outDir, { recursive: true });

const SAMPLE_ORDER = {
  orderNumber: 'GP-202609-0B3BA402',
  customerName: 'Aisha Nakato',
  totalUgx: 154000,
  subtotalUgx: 149000,
  deliveryFee: 5000,
  createdAt: new Date('2026-09-20T08:20:00Z'),
  items: [
    { productName: 'GoldPlus GP-P07 Power Bank with Digital Display', quantity: 1, unitPrice: 130000, finalLineTotal: 130000 },
    { productName: 'GoldPlus GP-L03 USB-C Fast Charging Cable, 1 m, 3A', quantity: 2, unitPrice: 4000, finalLineTotal: 8000 },
    { productName: 'GoldPlus GP-C08 12W USB Fast Charger, 2A (UK plug)', quantity: 1, unitPrice: 10000, finalLineTotal: 10000 },
  ],
  deliveryArea: 'Kansanga, Kampala',
  deliveryAddress: 'Plot 12, Ggaba Road',
};

const renderer = new NotificationTemplateRenderer();
const written: Array<{ file: string; subject: string; audience: string; when: string }> = [];

const WHEN: Record<string, string> = {
  ORDER_RECEIVED_UNPAID: 'The customer placed an order and has not paid yet.',
  ORDER_PAYMENT_PENDING: 'The customer started a payment and it has not resolved yet.',
  ORDER_PAYMENT_SUCCESS: 'The payment succeeded. This is the receipt.',
  ORDER_PAYMENT_FAILED: 'The payment did not go through.',
  ORDER_PAYMENT_CANCELLED: 'The order was cancelled and nothing was collected.',
  ORDER_FULFILLMENT_PROCESSING: 'The order is being prepared.',
  ORDER_DISPATCHED: 'The order is on its way to the customer.',
  ORDER_FULFILLMENT_COMPLETED: 'The order reached the customer.',
  ORDER_CANCELLED_BY_SHOP: 'The shop cancelled the order.',
  PHONE_VERIFICATION: 'A one-time code to prove the customer owns the phone number.',
  PASSWORD_RESET: 'The customer asked to reset their password.',
  PASSWORD_RESET_CODE: 'A one-time code for resetting a password.',
  password_reset: 'The customer asked to reset their password (legacy key).',
  SUPPORT_REQUEST_RECEIVED: 'The customer contacted support and we confirm receipt.',
  QUOTE_REQUEST_RECEIVED: 'The customer asked for a quote and we confirm receipt.',
  DEALER_APPLICATION_RECEIVED: 'A business applied to become a dealer.',
  FAKE_REPORT_RECEIVED: 'Someone reported a suspected counterfeit product.',
};

// 1. Order-status emails, with the full order summary table.
for (const key of NOTIFICATION_TEMPLATE_KEYS) {
  const html = renderer.renderEmail(key, SAMPLE_ORDER);
  const file = `customer-${key}.html`;
  writeFileSync(join(outDir, file), html, 'utf8');
  written.push({ file, subject: (html.match(/<title>([^<]*)<\/title>/) || [])[1] || key, audience: 'Customer', when: WHEN[key] ?? '' });
}

// 2. Every other customer transactional message.
for (const key of CUSTOMER_TRANSACTIONAL_TEMPLATES) {
  const copy = emailCopy(key, {
    orderNumber: SAMPLE_ORDER.orderNumber,
    customerName: SAMPLE_ORDER.customerName,
    totalUgx: SAMPLE_ORDER.totalUgx,
    code: '482913',
    resetUrl: 'https://shopgoldplus.com/account/reset?token=sample-token',
  } as never);
  if (!copy) continue;
  const file = `customer-${key}.html`;
  if (written.some((w) => w.file === file)) continue; // already covered above
  writeFileSync(join(outDir, file), renderer.renderCustomerEmail(copy, SAMPLE_ORDER.customerName), 'utf8');
  written.push({ file, subject: copy.subject, audience: 'Customer', when: WHEN[key] ?? '' });
}

// 3. The internal one: what the shop's own team is sent when an order lands.
const admin = renderAdminOrderEmail({
  event: 'payment-confirmed',
  orderNumber: SAMPLE_ORDER.orderNumber,
  createdAt: SAMPLE_ORDER.createdAt,
  preparationState: 'READY_FOR_PREPARATION',
  paymentMethod: 'pesapal',
  paymentStatus: 'paid',
  stockConfirmed: true,
  totalUgx: SAMPLE_ORDER.totalUgx,
  deliveryFeeUgx: SAMPLE_ORDER.deliveryFee,
  customerDisplayName: SAMPLE_ORDER.customerName,
  customerContactMasked: '+256 77* *** 545',
  deliverySummary: `${SAMPLE_ORDER.deliveryArea} — ${SAMPLE_ORDER.deliveryAddress}`,
  items: SAMPLE_ORDER.items.map((i, n) => ({
    sku: ['GP-P07', 'GP-L03', 'GP-C08'][n] ?? 'GP-000',
    name: i.productName,
    quantity: i.quantity,
    unitPriceUgx: i.unitPrice,
    lineTotalUgx: i.finalLineTotal,
  })),
  adminOrderLink: 'https://shopgoldplus.com/admin/orders/GP-202609-0B3BA402',
});
writeFileSync(join(outDir, 'internal-ADMIN_ORDER_EMAIL.html'), admin.html, 'utf8');
written.push({ file: 'internal-ADMIN_ORDER_EMAIL.html', subject: admin.subject, audience: 'Shop staff', when: 'An order is placed or paid. Sent to the shop, never to a customer.' });

const readme = `GoldPlus — transactional email templates
========================================

Sender:        noreply@shopgoldplus.com (replies go to support@shopgoldplus.com)
Website:       https://shopgoldplus.com
Business:      GoldPlus, Wilson Road, Kampala, Uganda
Generated:     ${new Date().toISOString().slice(0, 10)} from the live code
Regenerate:    npx tsx apps/api/src/scripts/export-email-templates.ts

Every file here is rendered by the same code that sends the real mail, with
SAMPLE data — no real customer's name, phone, address or order appears.

These are all TRANSACTIONAL messages: each one is a reply to something the
recipient did (placed an order, paid, asked to reset a password, contacted
support). There is no marketing mail, no mailing list and no bought contacts.
Recipients are people who gave us their address while buying or asking for help.

${written.map((w, i) => `${String(i + 1).padStart(2, ' ')}. ${w.file}
    Audience: ${w.audience}
    Subject:  ${w.subject}
    Sent when: ${w.when}`).join('\n\n')}
`;
writeFileSync(join(outDir, 'README.txt'), readme, 'utf8');
console.log(`${written.length} templates written to ${outDir}`);
