import type { CartItem } from './cart';

export interface CustomerDetails {
  name: string;
  email?: string;
  phone: string;
  deliveryArea: string;
  deliveryAddress: string;
}

export interface CheckoutPayload {
  customerDetails: CustomerDetails;
  buyerType: string;
  items: {
    productId: string;
    sku: string;
    name: string;
    price: number;
    quantity: number;
  }[];
}

export function validateCheckoutPayload(payload: Partial<CheckoutPayload>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!payload.customerDetails?.name?.trim()) {
    errors.push('Name is required');
  }
  if (!payload.customerDetails?.phone?.trim()) {
    errors.push('Phone is required');
  }
  if (!payload.customerDetails?.deliveryArea?.trim()) {
    errors.push('Delivery area is required');
  }
  if (!payload.customerDetails?.deliveryAddress?.trim()) {
    errors.push('Delivery address is required');
  }
  if (!payload.buyerType?.trim()) {
    errors.push('Buyer type is required');
  }
  if (!payload.items || payload.items.length === 0) {
    errors.push('Cart is empty');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function prepareCheckoutPayload(formData: FormData, cartItems: CartItem[]): CheckoutPayload {
  return {
    customerDetails: {
      name: (formData.get('name') as string) || '',
      email: (formData.get('email') as string) || undefined,
      phone: (formData.get('phone') as string) || '',
      deliveryArea: (formData.get('deliveryArea') as string) || '',
      deliveryAddress: (formData.get('deliveryAddress') as string) || ''
    },
    buyerType: (formData.get('buyerType') as string) || 'retail',
    items: cartItems.map(item => ({
      productId: item.productId,
      sku: item.sku || 'GEN-SKU',
      name: item.name,
      price: item.priceUgx,
      quantity: item.quantity
    }))
  };
}
