import { describe, it, expect } from 'vitest';
import { NotificationTemplateRenderer } from '../../apps/api/src/application/use-cases/notifications/NotificationTemplateRenderer';

describe('NotificationTemplateRenderer Truthfulness & Privacy Safeguards', () => {
  const renderer = new NotificationTemplateRenderer();

  const mockOrder = {
    id: 'f87b8d1a-4dcd-4e9e-b7d1-55c829e71bf0',
    orderNumber: 'GP-202605-A1B2',
    customerName: 'Amina Nakato <script>alert("hack")</script>',
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
      { name: 'GoldPlus Fast Charger <img src=x>', sku: 'GP-CHARGER-SAMPLE', quantity: 1, price: 150000 }
    ]
  };

  describe('Truthfulness Checks', () => {
    it('should never say "Payment successful" in ORDER_RECEIVED_UNPAID email receipt template', () => {
      const html = renderer.renderEmail('ORDER_RECEIVED_UNPAID', mockOrder);
      expect(html).not.toContain('Payment verified');
      expect(html).not.toContain('Excellent news');
      expect(html).toContain('Order received. Payment is still pending.');
    });

    it('should render verified state only when paymentStatus is paid in ORDER_PAYMENT_SUCCESS', () => {
      const paidOrder = { ...mockOrder, paymentStatus: 'paid', orderStatus: 'processing' };
      const html = renderer.renderEmail('ORDER_PAYMENT_SUCCESS', paidOrder);
      expect(html).toContain('Payment verified');
      expect(html).toContain('processing');
    });

    it('should handle pending state with ORDER_PAYMENT_PENDING template', () => {
      const pendingOrder = { ...mockOrder, paymentStatus: 'pending', orderStatus: 'pending_payment' };
      const html = renderer.renderEmail('ORDER_PAYMENT_PENDING', pendingOrder);
      expect(html).toContain('Payment pending verification');
      expect(html).not.toContain('Payment verified');
    });

    it('should handle cancelled states correctly without marking them as failures', () => {
      const cancelledOrder = { ...mockOrder, orderStatus: 'cancelled' };
      const html = renderer.renderEmail('ORDER_PAYMENT_CANCELLED', cancelledOrder);
      expect(html).toContain('Checkout cancelled. Your order has not been paid.');
      expect(html).not.toContain('failed');
    });
  });

  describe('Redesigned Email Template System Rules', () => {
    const templates: Array<'ORDER_RECEIVED_UNPAID' | 'ORDER_PAYMENT_PENDING' | 'ORDER_PAYMENT_SUCCESS' | 'ORDER_PAYMENT_FAILED' | 'ORDER_PAYMENT_CANCELLED' | 'ORDER_FULFILLMENT_PROCESSING' | 'ORDER_FULFILLMENT_COMPLETED'> = [
      'ORDER_RECEIVED_UNPAID',
      'ORDER_PAYMENT_PENDING',
      'ORDER_PAYMENT_SUCCESS',
      'ORDER_PAYMENT_FAILED',
      'ORDER_PAYMENT_CANCELLED',
      'ORDER_FULFILLMENT_PROCESSING',
      'ORDER_FULFILLMENT_COMPLETED'
    ];

    it('should output both non-empty HTML and plain-text fallbacks', () => {
      templates.forEach(tpl => {
        const html = renderer.renderEmail(tpl, mockOrder);
        const text = renderer.renderTextBody(tpl, mockOrder);

        expect(html).toBeTruthy();
        expect(text).toBeTruthy();

        // Structural check: HTML shell wrapped
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('<table');

        // Plain text contains zero HTML brackets
        expect(text).not.toContain('<div');
        expect(text).not.toContain('<table');
        expect(text).not.toContain('</html>');
      });
    });

    it('should strictly escape raw customer input data and sku names inside HTML', () => {
      const html = renderer.renderEmail('ORDER_RECEIVED_UNPAID', mockOrder);
      
      // Verification: Should contain escaped representations
      expect(html).toContain('Amina Nakato &lt;script&gt;alert(&quot;hack&quot;)&lt;/script&gt;');
      expect(html).toContain('GoldPlus Fast Charger &lt;img src=x&gt;');
      
      // Verification: Raw script and img brackets MUST not exist
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('<img src=x>');
    });

    it('should render exact CTA labels per order template type', () => {
      expect(renderer.renderEmail('ORDER_RECEIVED_UNPAID', mockOrder)).toContain('Complete Payment');
      expect(renderer.renderEmail('ORDER_PAYMENT_PENDING', mockOrder)).toContain('Track Order');
      expect(renderer.renderEmail('ORDER_PAYMENT_SUCCESS', mockOrder)).toContain('Track Order');
      expect(renderer.renderEmail('ORDER_PAYMENT_FAILED', mockOrder)).toContain('Retry Payment');
      expect(renderer.renderEmail('ORDER_PAYMENT_CANCELLED', mockOrder)).toContain('Return to Checkout');
      expect(renderer.renderEmail('ORDER_FULFILLMENT_PROCESSING', mockOrder)).toContain('Track Order');
      expect(renderer.renderEmail('ORDER_FULFILLMENT_COMPLETED', mockOrder)).toContain('View Order');
    });

    it('should include Uganda support hotline and order reference inside support footer card', () => {
      templates.forEach(tpl => {
        const html = renderer.renderEmail(tpl, mockOrder);
        expect(html).toContain('wa.me/256700000000');
        expect(html).toContain('GP-202605-A1B2');
      });
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

  describe('Brand Safety & Strict Copy Validation Rules', () => {
    const templates: Array<'ORDER_RECEIVED_UNPAID' | 'ORDER_PAYMENT_PENDING' | 'ORDER_PAYMENT_SUCCESS' | 'ORDER_PAYMENT_FAILED' | 'ORDER_PAYMENT_CANCELLED' | 'ORDER_FULFILLMENT_PROCESSING' | 'ORDER_FULFILLMENT_COMPLETED'> = [
      'ORDER_RECEIVED_UNPAID',
      'ORDER_PAYMENT_PENDING',
      'ORDER_PAYMENT_SUCCESS',
      'ORDER_PAYMENT_FAILED',
      'ORDER_PAYMENT_CANCELLED',
      'ORDER_FULFILLMENT_PROCESSING',
      'ORDER_FULFILLMENT_COMPLETED'
    ];

    it('should not contain any solar or hardware commerce references in any templates', () => {
      templates.forEach(tpl => {
        const html = renderer.renderEmail(tpl, mockOrder);
        const text = renderer.renderTextBody(tpl, mockOrder);
        const wa = renderer.renderWhatsApp(mockOrder);

        expect(html.toLowerCase()).not.toContain('solar');
        expect(text.toLowerCase()).not.toContain('solar');
        expect(wa.toLowerCase()).not.toContain('solar');

        expect(html.toLowerCase()).not.toContain('hardware commerce');
        expect(text.toLowerCase()).not.toContain('hardware commerce');
        expect(wa.toLowerCase()).not.toContain('hardware commerce');
      });
    });

    it('should enforce Official GoldPlus Online Store or approved copy positioning', () => {
      templates.forEach(tpl => {
        const html = renderer.renderEmail(tpl, mockOrder);
        expect(html).toContain('Official GoldPlus Online Store');
      });
    });

    it('should format all currency as UGX and never use USh', () => {
      templates.forEach(tpl => {
        const html = renderer.renderEmail(tpl, mockOrder);
        const text = renderer.renderTextBody(tpl, mockOrder);

        // Uses UGX format
        expect(html).toContain('UGX');
        expect(text).toContain('UGX');

        // Absolutely no USh
        expect(html).not.toContain('USh');
        expect(text).not.toContain('USh');
      });
    });

    it('should enforce state-truthful messaging across templates', () => {
      // Unpaid order received template
      const unpaidHtml = renderer.renderEmail('ORDER_RECEIVED_UNPAID', mockOrder);
      expect(unpaidHtml).toContain('Payment is still pending');
      expect(unpaidHtml).not.toContain('Payment verified');
      expect(unpaidHtml).toContain('>unpaid<');

      // Paid order success template
      const paidOrder = { ...mockOrder, paymentStatus: 'paid', orderStatus: 'processing' };
      const successHtml = renderer.renderEmail('ORDER_PAYMENT_SUCCESS', paidOrder);
      expect(successHtml).toContain('Payment verified');
      expect(successHtml).toContain('>paid<');

      // Cancelled template
      const cancelledOrder = { ...mockOrder, orderStatus: 'cancelled' };
      const cancelledHtml = renderer.renderEmail('ORDER_PAYMENT_CANCELLED', cancelledOrder);
      expect(cancelledHtml).toContain('Checkout cancelled');
      expect(cancelledHtml).not.toContain('failed');

      // Failed template
      const failedOrder = { ...mockOrder, orderStatus: 'failed' };
      const failedHtml = renderer.renderEmail('ORDER_PAYMENT_FAILED', failedOrder);
      expect(failedHtml).toContain('Payment was not completed');
      expect(failedHtml).not.toContain('cancelled');
    });
  });
});
