/** A signed-in customer's saved products (table wishlists, migration 0003). */
export interface IWishlistRepository {
  /** Product ids, most recently saved first. */
  list(userId: string, limit: number): Promise<string[]>;
  add(userId: string, productId: string): Promise<'added' | 'unknown_product'>;
  remove(userId: string, productId: string): Promise<void>;
  has(userId: string, productId: string): Promise<boolean>;
  count(userId: string): Promise<number>;
}
