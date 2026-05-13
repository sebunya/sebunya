export interface ICartQueryRepository {
  /**
   * Fetches a fully hydrated cart payload containing related product data (slug, category, names) 
   * and calculated financial subtotals for rendering.
   */
  getHydratedCart(cartId: string): Promise<any>;
}
