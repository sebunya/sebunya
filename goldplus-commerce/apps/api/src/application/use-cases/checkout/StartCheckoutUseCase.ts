export class StartCheckoutUseCase {
  async execute(cartId: string) {
    if (!cartId) throw new Error("Cart ID required");
    
    // Payment Gateway is not configured, throw explicit error
    throw new Error("NOT_CONFIGURED: Payment Gateway integration is missing. Cannot start checkout session.");
  }
}
