import { IPesaPalPaymentRepository } from '../../ports/IPesaPalPaymentRepository';
import { IOrderRepository } from '../commerce/CheckoutUseCase';
import { PesaPalClient } from '../../../infrastructure/payments/pesapal/PesaPalClient';

export interface StartPesaPalPaymentInput {
  orderId: string;
}

export interface StartPesaPalPaymentOutput {
  redirectUrl: string;
  orderTrackingId: string;
  merchantReference: string;
}

export class StartPesaPalPaymentUseCase {
  private paymentRepo: IPesaPalPaymentRepository;
  private orderRepo: IOrderRepository;
  private pesapalClient: PesaPalClient;

  constructor(
    paymentRepo: IPesaPalPaymentRepository,
    orderRepo: IOrderRepository,
    pesapalClient: PesaPalClient
  ) {
    this.paymentRepo = paymentRepo;
    this.orderRepo = orderRepo;
    this.pesapalClient = pesapalClient;
  }

  async execute(input: StartPesaPalPaymentInput): Promise<StartPesaPalPaymentOutput> {
    const orderId = input.orderId.trim();

    // 1. Reject draft/offline orders
    if (orderId.toUpperCase().startsWith('GP-DRAFT-')) {
      throw new Error('OFFLINE_DRAFT_PAYMENT_BLOCKED: Local offline demo orders cannot start payment flows.');
    }

    // 2. Resolve the matching order
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new Error(`MISSING_ORDER: Order with ID/Reference "${orderId}" not found.`);
    }

    if (order.paymentStatus === 'paid') {
      throw new Error('ORDER_ALREADY_PAID: This order has already been successfully paid.');
    }

    // 3. Generate a clean URL-safe merchant reference <= 50 chars
    // Format: GP-PAY-[:orderNo]-[:randomSuffix]
    const shortId = order.id.slice(0, 8);
    const merchantReference = `GP-${order.orderNumber}-${shortId}`.slice(0, 50);

    // 4. Check if there's an existing payment attempt that succeeded or is pending
    let attempt = await this.paymentRepo.findByMerchantReference(merchantReference);
    if (!attempt) {
      attempt = await this.paymentRepo.createPaymentAttempt({
        orderId: order.id,
        merchantReference,
        amount: order.totalUgx,
        currency: 'UGX',
        status: 'not_started',
      });
    }

    // 5. Submit order request to PesaPal (fails safely if credentials are not set)
    const emailAddress = order.customerEmail || 'billing@goldplus-uganda.com';
    const phoneNo = order.customerPhone || '0770000000';
    
    // Split full name safely into first/last
    const nameParts = order.customerName.split(' ');
    const firstName = nameParts[0] || 'Customer';
    const lastName = nameParts.slice(1).join(' ') || 'User';

    // Retrieve IPN ID from environment setup (fails dynamically at runtime if not configured)
    const ipnId = process.env.PESAPAL_IPN_ID;
    if (!ipnId) {
      throw new Error('PESAPAL_CONFIG_MISSING: The server-side PesaPal IPN notification identifier (PESAPAL_IPN_ID) is not configured.');
    }

    const callbackUrl = process.env.PESAPAL_CALLBACK_URL || 'http://localhost:3000/checkout/pesapal/callback';
    const cancellationUrl = process.env.PESAPAL_CANCELLATION_URL || 'http://localhost:3000/checkout/pesapal/cancelled';

    const pesapalResponse = await this.pesapalClient.submitOrderRequest({
      id: merchantReference,
      currency: 'UGX',
      amount: order.totalUgx,
      description: `Payment for order ${order.orderNumber}`,
      callback_url: callbackUrl,
      cancellation_url: cancellationUrl,
      notification_id: ipnId,
      billing_address: {
        email_address: emailAddress,
        phone_number: phoneNo,
        first_name: firstName,
        last_name: lastName,
      },
    });

    // 6. Update local attempt record with transaction parameters
    await this.paymentRepo.updatePaymentAttemptStatus(attempt.id, {
      status: 'pending',
      orderTrackingId: pesapalResponse.order_tracking_id,
      redirectUrl: pesapalResponse.redirect_url,
    });

    return {
      redirectUrl: pesapalResponse.redirect_url,
      orderTrackingId: pesapalResponse.order_tracking_id,
      merchantReference,
    };
  }
}
