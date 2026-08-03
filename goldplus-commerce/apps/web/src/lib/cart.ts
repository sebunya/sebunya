export interface CartItem {
  productId: string;
  sku: string;
  name: string;
  priceUgx: number;
  quantity: number;
  category?: string;
  /**
   * The cart page writes/reads its lines with `unitPriceUgx` and `slug`. Carrying both
   * names here keeps the local-cookie fallback in sync with that consumer: reading only
   * `priceUgx` there rendered every price as `UShNaN` and every PDP link as
   * `/products/` (undefined slug).
   */
  unitPriceUgx?: number;
  slug?: string;
}

export function calculateLineTotal(priceUgx: number, quantity: number): number {
  if (priceUgx < 0) return 0;
  return priceUgx * quantity;
}

export function calculateSubtotal(items: CartItem[]): number {
  return items.reduce((total, item) => {
    return total + calculateLineTotal(item.priceUgx, item.quantity);
  }, 0);
}

export function validateQuantity(quantity: number): number {
  if (quantity < 1) return 1;
  return quantity;
}

export function addOrUpdateCartItem(cart: CartItem[], newItem: CartItem): CartItem[] {
  const existingIndex = cart.findIndex(item => item.productId === newItem.productId);
  const updatedCart = [...cart];
  
  if (existingIndex >= 0) {
    updatedCart[existingIndex] = {
      ...updatedCart[existingIndex],
      quantity: validateQuantity(updatedCart[existingIndex].quantity + newItem.quantity)
    };
  } else {
    updatedCart.push({ ...newItem, quantity: validateQuantity(newItem.quantity) });
  }
  
  return updatedCart;
}

export function removeCartItem(cart: CartItem[], productId: string): CartItem[] {
  return cart.filter(item => item.productId !== productId);
}

export function parseLocalCartCookie(cookieValue: string | undefined): CartItem[] {
  if (!cookieValue) return [];
  try {
    const parsed = JSON.parse(cookieValue);
    if (Array.isArray(parsed)) {
      return parsed.map(item => {
        const price = Number(item.priceUgx || item.unitPriceUgx || 0);
        return {
          productId: String(item.productId || ''),
          sku: String(item.sku || ''),
          name: String(item.name || ''),
          priceUgx: price,
          // Alias for the cart page, which reads `unitPriceUgx`. Without it the fallback
          // render produced `UShNaN`.
          unitPriceUgx: price,
          quantity: validateQuantity(Number(item.quantity || 1)),
          category: item.category ? String(item.category) : undefined,
          // Preserved so the fallback line still links to its product page.
          slug: item.slug ? String(item.slug) : undefined,
        };
      });
    }
  } catch {
    // Ignore invalid JSON parsing errors
  }
  return [];
}
