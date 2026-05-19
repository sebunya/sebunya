import * as fs from 'fs';
import * as path from 'path';
import { NotificationTemplateRenderer } from '../apps/api/src/application/use-cases/notifications/NotificationTemplateRenderer';

const renderer = new NotificationTemplateRenderer();

const sampleOrder = {
  id: 'f87b8d1a-4dcd-4e9e-b7d1-55c829e71bf0',
  orderNumber: 'GP-SAMPLE-001',
  customerName: 'Robert Sample',
  customerPhone: '256700000000',
  customerEmail: 'customer@example.com',
  deliveryArea: 'Kampala Central',
  deliveryAddress: 'Sample delivery address, Kampala',
  buyerType: 'retail',
  totalUgx: 150000,
  subtotalUgx: 150000,
  paymentStatus: 'unpaid', // default, overridden per template
  orderStatus: 'received', // default, overridden per template
  createdAt: new Date('2026-05-19T09:00:00.000Z').toISOString(),
  items: [
    { name: 'GoldPlus Fast Charger', productName: 'GoldPlus Fast Charger', sku: 'GP-CHARGER-SAMPLE', quantity: 1, price: 150000, unitPrice: 150000 }
  ]
};

const outputDir = path.join(__dirname, '../docs/previews/notifications');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// 1. ORDER_RECEIVED_UNPAID
const unpaidOrder = { ...sampleOrder, paymentStatus: 'unpaid', orderStatus: 'received' };
const unpaidHtml = renderer.renderEmail('ORDER_RECEIVED_UNPAID', unpaidOrder);
fs.writeFileSync(path.join(outputDir, 'email-order-received-unpaid.html'), unpaidHtml, 'utf8');

// 2. ORDER_PAYMENT_SUCCESS
const successOrder = { ...sampleOrder, paymentStatus: 'paid', orderStatus: 'processing' };
const successHtml = renderer.renderEmail('ORDER_PAYMENT_SUCCESS', successOrder);
fs.writeFileSync(path.join(outputDir, 'email-order-payment-success.html'), successHtml, 'utf8');

// 3. ORDER_PAYMENT_FAILED
const failedOrder = { ...sampleOrder, paymentStatus: 'failed', orderStatus: 'failed' };
const failedHtml = renderer.renderEmail('ORDER_PAYMENT_FAILED', failedOrder);
fs.writeFileSync(path.join(outputDir, 'email-order-payment-failed.html'), failedHtml, 'utf8');

// 4. ORDER_PAYMENT_CANCELLED
const cancelledOrder = { ...sampleOrder, paymentStatus: 'unpaid', orderStatus: 'cancelled' };
const cancelledHtml = renderer.renderEmail('ORDER_PAYMENT_CANCELLED', cancelledOrder);
fs.writeFileSync(path.join(outputDir, 'email-order-payment-cancelled.html'), cancelledHtml, 'utf8');

console.log('Successfully generated clean transactional email preview files in docs/previews/notifications/');
