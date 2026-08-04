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

      // Lean picker shape (2026 rework): { district, area?, displayLabel }.
      // The structured layer stops at the verified district + known area; the
      // fine detail is the customer's own free-text address line. Checked
      // FIRST so the legacy gazetteer parsing below never mangles it.
      if (loc.district && !loc.parishWard && !loc.parish) {
        const district = String(loc.district).trim();
        const area = loc.area ? String(loc.area).trim() : '';
        deliveryArea = area ? `${area}, ${district}` : district;
        const rawDetails = String(formData.get('deliveryAddress') || '').trim();
        deliveryAddress = rawDetails || deliveryArea;
        deliveryLocation = {
          district,
          displayLabel: loc.displayLabel ? String(loc.displayLabel) : deliveryArea,
        };
        return {
          customerDetails: {
            name: (formData.get('name') as string) || '',
            email: (formData.get('email') as string) || undefined,
            phone: (formData.get('phone') as string) || '',
            deliveryArea,
            deliveryAddress,
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

      // Composed from the parts that are actually PRESENT.
      //
      // Both strings were built by interpolating optional fields directly, so a
      // location without a parish, a region or a postcode produced literal
      // "undefined" in the address — `undefined | undefined, Kampala` and
      // `Plot 1 | undefined · Postcode undefined`. That string is what the
      // delivery driver reads and what the admin sees on the order, and only the
      // district is guaranteed for a Uganda location. Found by the end-to-end
      // harness: typecheck and every component test passed, because `${undefined}`
      // is a valid string.
      const present = (...parts: unknown[]) =>
        parts
          .map((part) => (part === null || part === undefined ? '' : String(part).trim()))
          .filter(Boolean);

      const areaParts = present(loc.parishWard || loc.parish, loc.subcountyDivisionTc || loc.subcounty);
      const district = present(loc.district).join('');
      deliveryArea = areaParts.length > 0
        ? `${areaParts.join(' | ')}${district ? `, ${district}` : ''}`
        : district;

      const rawDetails = String(formData.get('deliveryAddress') || '').trim();
      const postcode = present(loc.postcode).join('');
      const adminDetails = present(
        loc.countyOrMunicipality || loc.county,
        loc.region,
        postcode ? `Postcode ${postcode}` : '',
      ).join(' · ');
      deliveryAddress = [rawDetails, adminDetails].filter(Boolean).join(' | ');
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
