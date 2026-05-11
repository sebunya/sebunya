export interface CartItem {
  productId: string;
  sku: string;
  name: string;
  priceUgx: number;
  quantity: number;
  category?: string;
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
