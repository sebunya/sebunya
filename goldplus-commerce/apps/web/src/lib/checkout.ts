import type { CartItem } from './cart';

export interface CustomerDetails {
  name: string;
  email?: string;
  phone: string;
  deliveryArea: string;
  deliveryAddress: string;
}

export interface CheckoutPayload {
  customerDetails: CustomerDetails & { deliveryLocation?: StructuredDeliveryLocation | null };
  buyerType: string;
  /**
   * Slice 3B: the server prices every line from the catalogue. Only
   * productId and quantity are sent — client-side prices are never trusted.
   */
  items: {
    productId: string;
    quantity: number;
  }[];
  /** Idempotency key so a resubmitted form cannot create a duplicate order. */
  clientOrderKey?: string;
}

export interface StructuredDeliveryLocation {
  district: string;
  region?: string;
  countyOrMunicipality?: string;
  subcountyDivisionTc?: string;
  parishWard?: string;
  postcode?: string;
  displayLabel?: string;
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
  const locationJson = String(formData.get('locationJson') ?? '');
  let deliveryArea = '';
  let deliveryAddress = '';
  let deliveryLocation: StructuredDeliveryLocation | null = null;

  if (locationJson.startsWith('{')) {
    try {
      const loc = JSON.parse(locationJson);
      deliveryArea = `${loc.parishWard || loc.parish} | ${loc.subcountyDivisionTc || loc.subcounty}, ${loc.district}`;
      const rawDetails = String(formData.get('deliveryAddress') || '').trim();
      const adminDetails = `${loc.countyOrMunicipality || loc.county || ''} · ${loc.region} · Postcode ${loc.postcode}`.replace(/^\s*·\s*/, '').trim();
      deliveryAddress = rawDetails ? `${rawDetails} | ${adminDetails}` : adminDetails;
      if (loc.district) {
        deliveryLocation = {
          district: String(loc.district),
          region: loc.region ? String(loc.region) : undefined,
          countyOrMunicipality: loc.countyOrMunicipality || loc.county ? String(loc.countyOrMunicipality || loc.county) : undefined,
          subcountyDivisionTc: loc.subcountyDivisionTc || loc.subcounty ? String(loc.subcountyDivisionTc || loc.subcounty) : undefined,
          parishWard: loc.parishWard || loc.parish ? String(loc.parishWard || loc.parish) : undefined,
          postcode: loc.postcode ? String(loc.postcode) : undefined,
          displayLabel: loc.displayLabel ? String(loc.displayLabel) : undefined,
        };
      }
    } catch (e) {
      // fallback to whatever raw text was submitted if JSON decode exploded
      deliveryArea = String(formData.get('deliveryArea') || '');
      deliveryAddress = String(formData.get('deliveryAddress') || '');
    }
  } else {
    // Pure fallback if legacy form is running
    deliveryArea = String(formData.get('deliveryArea') || formData.get('location') || '');
    deliveryAddress = String(formData.get('deliveryAddress') || deliveryArea || '');
  }

  return {
    customerDetails: {
      name: (formData.get('name') as string) || '',
      email: (formData.get('email') as string) || undefined,
      phone: (formData.get('phone') as string) || '',
      deliveryArea: deliveryArea.trim(),
      deliveryAddress: deliveryAddress.trim(),
      deliveryLocation,
    },
    buyerType: (formData.get('buyerType') as string) || 'retail',
    items: cartItems.map(item => ({
      productId: item.productId,
      quantity: Number(item.quantity) || 1
    })),
    clientOrderKey: String(formData.get('clientOrderKey') || '').trim() || undefined
  };
}
