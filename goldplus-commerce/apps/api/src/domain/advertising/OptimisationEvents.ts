/**
 * Early-signal conversions a destination may optimise on (docs/advertising
 * README, "Early signals"). The purchase is always sent: it is the sale, and
 * it travels through the durable delivery path, not this selection.
 */
export const EARLY_SIGNAL_EVENTS = ['view_item', 'add_to_cart', 'begin_checkout', 'add_payment_info', 'generate_lead'] as const;
export type EarlySignalEvent = typeof EARLY_SIGNAL_EVENTS[number];

export const EARLY_SIGNAL_LABEL: Record<EarlySignalEvent, string> = {
  view_item: 'Product view',
  add_to_cart: 'Add to cart',
  begin_checkout: 'Checkout started',
  add_payment_info: 'Payment method chosen',
  generate_lead: 'Lead (WhatsApp click or quote request)',
};

/**
 * Whether a destination sends this event. `selection` null = every event the
 * platform supports (the behaviour before selections existed). Events that are
 * not early signals (purchase, refund) are never filtered here.
 */
export function eventSelected(selection: readonly string[] | null | undefined, eventName: string): boolean {
  if (!(EARLY_SIGNAL_EVENTS as readonly string[]).includes(eventName)) return true;
  return selection == null || selection.includes(eventName);
}

/** A submitted selection, reduced to known early-signal events the platform supports. */
export function cleanSelection(input: unknown, supported: readonly string[]): string[] | null {
  if (!Array.isArray(input)) return null;
  const known = new Set(EARLY_SIGNAL_EVENTS as readonly string[]);
  return [...new Set(input.map(String))].filter((e) => known.has(e) && supported.includes(e)).sort();
}

export const LEAD_METHODS = ['whatsapp', 'quote_request'] as const;
export type LeadMethod = typeof LEAD_METHODS[number];
