/** Labels for Goldie's conversation archive in admin (topics are the router's intents). */
export const TOPIC_LABEL: Record<string, string> = {
  PRODUCT: 'Products and prices', BATTERY: 'Phone batteries', ORDER: 'Orders', PAYMENT: 'Payments', DELIVERY: 'Delivery', POLICY: 'Warranty, returns, authenticity',
  BULK: 'Bulk and business', STORE: 'Shop location and hours', LOYALTY: 'Points and rewards', OTHER: 'Other',
};
export const MOOD_LABEL: Record<string, string> = { upset: 'Upset', worried: 'Worried', confused: 'Confused', neutral: 'Calm', happy: 'Happy' };
export const OUTCOME_LABEL: Record<string, string> = { open: 'Open', resolved: 'Resolved', handed_over: 'With the team', needs_human: 'Needs a person' };
export const CHANNEL_LABEL: Record<string, string> = { web: 'Website', whatsapp: 'WhatsApp' };
export const pct = (r: number | null) => (r == null ? 'no data' : `${Math.round(r * 100)}%`);
/** The Customer DNA next-best action Goldie was given, in plain words. */
export const NBA_LABEL: Record<string, string> = {
  RESUME_CART: 'help finish the cart', COMPLETE_CHECKOUT: 'help finish the checkout', LOYALTY_ACTION: 'use their points', DELIVERY_FOLLOW_UP: 'check on a delivery',
  SUPPORT_FOLLOW_UP: 'follow up an open support matter', WIN_BACK: 'welcome back a lapsed customer', RETENTION: 'thank a regular', BACK_IN_STOCK: 'something they wanted is back',
  RECOMMEND_PRODUCT: 'suggest a related product', PRODUCT_EDUCATION: 'help them choose', COMPATIBILITY_GUIDANCE: 'help with what fits their phone',
};
