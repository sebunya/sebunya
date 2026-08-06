/**
 * Parcel classification (pre-decided, 2026-08-06).
 *
 * NOT a weight system. A shipping class is a property of the goods, resolved in
 * a fixed precedence and never guessed:
 *
 *   1. the product's own override
 *   2. its category's default
 *   3. unresolvable
 *
 * Unresolvable on a bus destination is `PARCEL_CLASS_UNKNOWN` and goes to the
 * manual queue. It is NEVER defaulted to small — small is the cheapest class,
 * so guessing it would systematically under-charge and the error would only
 * surface when a carrier refused the parcel at the counter.
 *
 * Bus parcel offices count PARCELS. Everything here is therefore per-parcel:
 * a basket that exceeds one parcel's capacity is two parcels and two fees, and
 * that is shown to the customer before they commit, because a surprise second
 * fee is a dispute.
 */

export const SHIPPING_CLASSES = ['small', 'medium', 'large'] as const;
export type ShippingClass = (typeof SHIPPING_CLASSES)[number];

export function isShippingClass(value: string | null | undefined): value is ShippingClass {
  return typeof value === 'string' && (SHIPPING_CLASSES as readonly string[]).includes(value);
}

/**
 * Ordered smallest first, so "the highest class present in the basket" is a
 * real comparison rather than an alphabetical accident.
 */
export function classRank(cls: ShippingClass): number {
  return SHIPPING_CLASSES.indexOf(cls);
}

export interface BasketLine {
  productId: string;
  quantity: number;
  /** The product's own override. Null means fall through to the category. */
  productShippingClass: string | null;
  /** The category default, set by an operator. Null means unset. */
  categoryShippingClass: string | null;
  /** For the message when a line is what blocks classification. */
  productName?: string;
}

export type ResolvedLineClass =
  | { ok: true; productId: string; shippingClass: ShippingClass; source: 'product' | 'category' }
  | { ok: false; productId: string; productName: string | null };

/** One line's class, by the fixed precedence. No guessing at any step. */
export function resolveLineClass(line: BasketLine): ResolvedLineClass {
  if (isShippingClass(line.productShippingClass)) {
    return { ok: true, productId: line.productId, shippingClass: line.productShippingClass, source: 'product' };
  }
  if (isShippingClass(line.categoryShippingClass)) {
    return { ok: true, productId: line.productId, shippingClass: line.categoryShippingClass, source: 'category' };
  }
  return { ok: false, productId: line.productId, productName: line.productName ?? null };
}

export type ParcelPlan =
  | {
      ok: true;
      /** The highest class present, which sizes every parcel in the basket. */
      shippingClass: ShippingClass;
      totalItems: number;
      /** Null capacity means one parcel is only knowable for a single item. */
      capacityItems: number | null;
      parcelCount: number;
      /** Which line set the class, so an operator can see why. */
      classSetBy: { productId: string; source: 'product' | 'category' };
    }
  | {
      ok: false;
      reason: 'PARCEL_CLASS_UNKNOWN' | 'PARCEL_CAPACITY_UNKNOWN' | 'EMPTY_BASKET';
      /** Named so ops know exactly what to go and set. */
      detail: string;
      unclassifiedProductIds: string[];
    };

/**
 * Plan the parcels for a basket.
 *
 * `capacityByClass` is operator configuration and ships unset. When it is unset
 * this can still answer for a SINGLE item — one item cannot exceed any capacity
 * of one or more, so "one parcel" is arithmetic rather than an assumption. For
 * anything larger it refuses, because splitting a basket without knowing what a
 * parcel holds would invent the number of fees the customer pays.
 */
export function planParcels(
  lines: readonly BasketLine[],
  capacityByClass: Partial<Record<ShippingClass, number | null>>,
): ParcelPlan {
  if (lines.length === 0) {
    return { ok: false, reason: 'EMPTY_BASKET', detail: 'There is nothing in the basket to ship.', unclassifiedProductIds: [] };
  }

  const resolved = lines.map(resolveLineClass);
  const unresolved = resolved.filter((r): r is Extract<ResolvedLineClass, { ok: false }> => !r.ok);
  if (unresolved.length > 0) {
    const names = unresolved.map((u) => u.productName ?? u.productId).slice(0, 5);
    return {
      ok: false,
      reason: 'PARCEL_CLASS_UNKNOWN',
      detail: `No shipping class is set for ${names.join(', ')}${unresolved.length > 5 ? ` and ${unresolved.length - 5} more` : ''}. Set it on the product, or set a default for its category.`,
      unclassifiedProductIds: unresolved.map((u) => u.productId),
    };
  }

  const ok = resolved as Array<Extract<ResolvedLineClass, { ok: true }>>;
  // The highest class present sizes the whole shipment. A large item in the
  // basket means large parcels, whatever else is in there.
  let highest = ok[0];
  for (const r of ok) if (classRank(r.shippingClass) > classRank(highest.shippingClass)) highest = r;

  const totalItems = lines.reduce((n, l) => n + Math.max(0, Math.trunc(l.quantity)), 0);
  if (totalItems <= 0) {
    return { ok: false, reason: 'EMPTY_BASKET', detail: 'There is nothing in the basket to ship.', unclassifiedProductIds: [] };
  }

  const capacity = capacityByClass[highest.shippingClass] ?? null;
  if (capacity === null || !Number.isFinite(capacity) || capacity <= 0) {
    // One item is one parcel whatever the capacity, so this much is arithmetic.
    if (totalItems === 1) {
      return {
        ok: true,
        shippingClass: highest.shippingClass,
        totalItems,
        capacityItems: null,
        parcelCount: 1,
        classSetBy: { productId: highest.productId, source: highest.source },
      };
    }
    return {
      ok: false,
      reason: 'PARCEL_CAPACITY_UNKNOWN',
      detail: `Nobody has set how many items fit in one ${highest.shippingClass} parcel, so the number of parcels — and therefore the number of fees — cannot be worked out.`,
      unclassifiedProductIds: [],
    };
  }

  return {
    ok: true,
    shippingClass: highest.shippingClass,
    totalItems,
    capacityItems: capacity,
    parcelCount: Math.ceil(totalItems / capacity),
    classSetBy: { productId: highest.productId, source: highest.source },
  };
}

/** Registry keys for the per-class capacities. Never spelled by a caller. */
export const PARCEL_CAPACITY_KEYS: Record<ShippingClass, string> = {
  small: 'parcel_capacity_small_items',
  medium: 'parcel_capacity_medium_items',
  large: 'parcel_capacity_large_items',
};

export function capacitiesFromConfig(config: Record<string, number>): Partial<Record<ShippingClass, number | null>> {
  const out: Partial<Record<ShippingClass, number | null>> = {};
  for (const cls of SHIPPING_CLASSES) {
    const v = config[PARCEL_CAPACITY_KEYS[cls]];
    out[cls] = Number.isFinite(v) ? v : null;
  }
  return out;
}

/**
 * What the customer is told about parcel count, BEFORE they commit.
 *
 * Two parcels is two fees. A customer who discovers that after paying has a
 * legitimate complaint, so the sentence exists and is built from facts.
 */
export function parcelCountSentence(plan: Extract<ParcelPlan, { ok: true }>, perParcelFeeUgx: number): string {
  if (plan.parcelCount === 1) return 'Your order ships as one parcel.';
  return `Your order is too big for one parcel, so it ships as ${plan.parcelCount} parcels at UGX ${perParcelFeeUgx.toLocaleString('en-UG')} each.`;
}
