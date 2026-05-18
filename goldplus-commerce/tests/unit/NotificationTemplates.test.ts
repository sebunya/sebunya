import { describe, it, expect } from 'vitest';
import { NotificationTemplateRenderer } from '../../apps/api/src/application/use-cases/notifications/NotificationTemplateRenderer';

describe('NotificationTemplateRenderer Truthfulness & Privacy Safeguards', () => {
  const renderer = new NotificationTemplateRenderer();

  const mockOrder = {
    id: 'f87b8d1a-4dcd-4e9e-b7d1-55c829e71bf0',
    orderNumber: 'GP-202605-A1B2',
    customerName: 'Amina Nakato',
    customerPhone: '0772000000',
    customerEmail: 'amina.n@example.com',
    deliveryArea: 'Kampala Central',
    deliveryAddress: 'Plot 45, Jinja Road, Kampala',
    buyerType: 'retail',
    totalUgx: 250000,
    subtotalUgx: 250000,
    paymentStatus: 'unpaid',
    orderStatus: 'received',
    createdAt: new Date().toISOString(),
    items: [
      { name: 'Premium Solar Battery 100Ah', sku: 'GP-SKU-BATT', quantity: 1, price: 250000 }
    ]
  };

  describe('Truthfulness Checks', () => {
    it('should never say "Payment successful" in ORDER_RECEIVED_UNPAID email receipt template', () => {
      const html = renderer.renderEmail('ORDER_RECEIVED_UNPAID', mockOrder);
      expect(html).not.toContain('Payment verified');
      expect(html).not.toContain('Excellent news');
      expect(html).toContain('Awaiting Payment');
    });

    it('should render verified state only when paymentStatus is paid in ORDER_PAYMENT_SUCCESS', () => {
      const paidOrder = { ...mockOrder, paymentStatus: 'paid', orderStatus: 'processing' };
      const html = renderer.renderEmail('ORDER_PAYMENT_SUCCESS', paidOrder);
      expect(html).toContain('Payment Confirmed');
      expect(html).toContain('verified');
      expect(html).toContain('processing');
    });

    it('should handle pending state with ORDER_PAYMENT_PENDING template', () => {
      const pendingOrder = { ...mockOrder, paymentStatus: 'pending', orderStatus: 'pending_payment' };
      const html = renderer.renderEmail('ORDER_PAYMENT_PENDING', pendingOrder);
      expect(html).toContain('Payment Verification Pending');
      expect(html).not.toContain('Payment verified');
    });

    it('should handle cancelled states correctly without marking them as failures', () => {
      const cancelledOrder = { ...mockOrder, orderStatus: 'cancelled' };
      const html = renderer.renderEmail('ORDER_PAYMENT_CANCELLED', cancelledOrder);
      expect(html).toContain('Payment Attempt Cancelled');
      expect(html).not.toContain('failed');
    });
  });

  describe('WhatsApp PII Isolation Safeguards', () => {
    it('should include order reference and not leak buyer email, phone, or delivery address', () => {
      const waText = renderer.renderWhatsApp(mockOrder);
      
      // Verification rules: Must contain reference
      expect(waText).toContain(mockOrder.orderNumber);
      
      // Verification rules: Must NOT contain unmasked phone, email or address landmark
      expect(waText).not.toContain(mockOrder.customerEmail);
      expect(waText).not.toContain(mockOrder.customerPhone);
      expect(waText).not.toContain(mockOrder.deliveryAddress);
    });

    it('should adapt WhatsApp notification content for payment pending status', () => {
      const pendingOrder = { ...mockOrder, orderStatus: 'pending_payment' };
      const waText = renderer.renderWhatsApp(pendingOrder);
      
      expect(waText).toContain('Pending verification');
      expect(waText).not.toContain('Successfully Verified');
    });

    it('should adapt WhatsApp notification content for paid and processing status', () => {
      const paidOrder = { ...mockOrder, paymentStatus: 'paid', orderStatus: 'processing' };
      const waText = renderer.renderWhatsApp(paidOrder);
      
      expect(waText).toContain('Successfully Verified');
      expect(waText).toContain('Fulfillment is in progress');
    });
  });
});
