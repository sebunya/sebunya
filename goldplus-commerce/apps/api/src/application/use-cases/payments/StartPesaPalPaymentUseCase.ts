import { randomUUID } from 'node:crypto';
import { IPesaPalPaymentRepository } from '../../ports/IPesaPalPaymentRepository';
import { IOrderRepository } from '../commerce/CheckoutUseCase';
import { IPesaPalClient } from '../../ports/IPesaPalClient';

export interface StartPesaPalPaymentInput {
  orderId: string;
}

export interface StartPesaPalPaymentOutput {
  redirectUrl: string;
  orderTrackingId: string;
  merchantReference: string;
}

/**
 * The provider's return destination: our API, never the storefront.
 *
 * Derived from PUBLIC_API_BASE_URL when unset, so this works without a new
 * environment variable, and refuses a value that points at the storefront page,
 * which is the misconfiguration this replaced.
 */
export const PESAPAL_CALLBACK_PATH = '/commerce/payments/pesapal/callback';

export function providerCallbackUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = (env.PESAPAL_PROVIDER_CALLBACK_URL ?? '').trim();
  if (explicit) return explicit;

  const apiOrigin = (env.PUBLIC_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (apiOrigin) return `${apiOrigin}${PESAPAL_CALLBACK_PATH}`;

  return `http://localhost:3000${PESAPAL_CALLBACK_PATH}`;
}

/** Appends `reference=<merchantReference>` to the provider's cancel destination. */
export function withMerchantReference(url: string, merchantReference: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}reference=${encodeURIComponent(merchantReference)}`;
}

export class StartPesaPalPaymentUseCase {
  private paymentRepo: IPesaPalPaymentRepository;
  private orderRepo: IOrderRepository;
  private pesapalClient: IPesaPalClient;

  constructor(
    paymentRepo: IPesaPalPaymentRepository,
    orderRepo: IOrderRepository,
    pesapalClient: IPesaPalClient
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

    // 3. Generate a clean URL-safe merchant reference <= 50 chars.
    // Kept under 43 so a retry suffix still fits inside the provider's limit.
    const shortId = order.id.slice(0, 8);
    const baseReference = `GP-${order.orderNumber}-${shortId}`.slice(0, 43);

    // 4. Reuse a live attempt; NEVER try to revive a dead one.
    //
    // WHAT WAS WRONG
    // The merchant reference was derived only from the order, so it was the same
    // on every retry, and the column is UNIQUE. After a declined or abandoned
    // payment — the most common outcome on Ugandan mobile money — the lookup
    // returned that same TERMINAL attempt (`failed`, `invalid`, `reversed`,
    // `abandoned` have no legal exit). The provider was then asked for a NEW live
    // transaction, and only afterwards did the write to `pending` throw
    // PAYMENT_STATE_ILLEGAL_TRANSITION.
    //
    // So the customer could never pay for that order again — every attempt ended
    // as "payment could not be started" — and worse, each one opened a real
    // provider transaction whose tracking id was never stored, so if it WAS paid
    // it matched nothing on our side.
    //
    // A terminal attempt is history. A retry gets a genuinely new attempt under
    // its own reference, which is what the caller already documents it needs.
    let merchantReference = baseReference;
    let attempt = await this.paymentRepo.findByMerchantReference(merchantReference);

    // Money the provider already reported collected on this reference: opening
    // another payable page could take it twice. Refused BEFORE the provider is
    // asked for anything, so no orphan transaction is created.
    if (attempt && attempt.status === 'completed') {
      throw new Error('PAYMENT_ALREADY_COLLECTED: This order has a completed payment attempt awaiting review.');
    }

    // Only an attempt that never reached the provider, at the order's CURRENT
    // total, may be submitted again. Anything else gets a fresh attempt:
    //  - a TERMINAL attempt is history (above);
    //  - a `pending` / `verification_*` attempt already holds a live provider
    //    transaction. Re-submitting it overwrote its tracking id, so a payment
    //    made on that first page matched nothing on our side (UNKNOWN_ATTEMPT,
    //    money collected against an unpaid order) and the poller could no
    //    longer see it. `verification_failed` also threw on the pending write
    //    AFTER the provider transaction had been opened;
    //  - an attempt at a different amount (a delivery variance changed the
    //    total after it was recorded) would quote the stale figure, and
    //    verification compares against the attempt, so the order settled as
    //    fully paid at the wrong total. StartOrderPaymentUseCase declines to
    //    reuse such an attempt; this is where that decision is honoured.
    // The old attempt is left exactly as it is, tracking id included, so the
    // poller and IPN still match anything paid on its page.
    const resubmittable =
      attempt &&
      attempt.status === 'not_started' &&
      !attempt.orderTrackingId &&
      attempt.amount === order.totalUgx;
    if (attempt && !resubmittable) {
      merchantReference = `${baseReference}-${randomUUID().replace(/-/g, '').slice(0, 6)}`;
      attempt = null;
    }

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

    // WHERE THE PROVIDER SENDS THE CUSTOMER BACK.
    //
    // This is NOT the storefront page. PesaPal must return to the API route
    // GET /commerce/payments/pesapal/callback, which settles the payment and
    // only then redirects to the storefront with the parameters that page reads.
    //
    // One variable used to serve both roles, and production set it to the
    // storefront page. So PesaPal sent the paying customer straight there,
    // carrying OrderTrackingId and OrderMerchantReference, while the page reads
    // `status` and `reference`. Both were absent, so every payment — including
    // every SUCCESSFUL one — rendered "We could not confirm your payment.
    // Please do not pay again until we have checked", with no order number, and
    // the basket cookie was left in place so the next checkout re-added the
    // items just paid for. Settlement happened later via the IPN or the poller,
    // which is why the money arrived while the customer was being alarmed.
    //
    // Pointing the single variable at the API instead only moved the fault: the
    // API would redirect to itself. The two destinations are genuinely
    // different things and now have their own values. The default is derived
    // from the API's own public origin so a deployment that never sets it still
    // returns to the right place.
    const callbackUrl = providerCallbackUrl();
    // The cancelled page names the order from `reference` (it reads it through
    // orderNumberFromMerchantReference); without it, a guest who cancels on a
    // new device has no order number to pay or track by.
    const cancellationUrl = withMerchantReference(
      process.env.PESAPAL_CANCELLATION_URL || 'http://localhost:3000/checkout/pesapal/cancelled',
      attempt.merchantReference,
    );

    const pesapalResponse = await this.pesapalClient.submitOrderRequest({
      // The reference this attempt was created under, so the provider
      // transaction and our row always name each other.
      id: attempt.merchantReference,
      // Retry integrity: once the attempt exists, its committed order-derived
      // amount/currency are immutable and remain the provider request source.
      currency: attempt.currency,
      amount: attempt.amount,
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
      // The stored reference, not the local one, so caller and row cannot drift.
      merchantReference: attempt.merchantReference,
    };
  }
}
