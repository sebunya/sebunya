/** Labels for Goldie's conversation archive in admin (topics are the router's intents). */
export const TOPIC_LABEL: Record<string, string> = {
  PRODUCT: 'Products and prices', BATTERY: 'Phone batteries', ORDER: 'Orders', PAYMENT: 'Payments', DELIVERY: 'Delivery', POLICY: 'Warranty, returns, authenticity',
  BULK: 'Bulk and business', STORE: 'Shop location and hours', LOYALTY: 'Points and rewards', OTHER: 'Other',
};
export const MOOD_LABEL: Record<string, string> = { upset: 'Upset', worried: 'Worried', confused: 'Confused', neutral: 'Calm', happy: 'Happy' };
export const OUTCOME_LABEL: Record<string, string> = { open: 'Open', resolved: 'Resolved', handed_over: 'With the team', needs_human: 'Needs a person' };
export const CHANNEL_LABEL: Record<string, string> = { web: 'Website', whatsapp: 'WhatsApp' };
export const pct = (r: number | null) => (r == null ? 'no data' : `${Math.round(r * 100)}%`);
