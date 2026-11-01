import type { AstroCookies } from 'astro';
import { ORDER_NUMBER_PATTERN } from './checkout';

/**
 * The order a Pesapal handoff is for, remembered on this device for the
 * cancellation page. Pesapal's cancellation URL is a fixed address that does
 * not reliably name the order, and that page's "Pay for this order" used to
 * send the customer to /checkout, whose basket had just been emptied.
 * Shared by checkout and the signed-in order page.
 */
export function rememberPaymentOrder(cookies: AstroCookies, orderNumber: string | undefined | null, secure: boolean): void {
  if (!orderNumber || !ORDER_NUMBER_PATTERN.test(orderNumber)) return;
  try {
    cookies.set('gp_pay_order', orderNumber, {
      path: '/checkout/pesapal', maxAge: 60 * 60 * 6, httpOnly: true, sameSite: 'lax', secure,
    });
  } catch { /* a convenience for the cancellation page */ }
}
