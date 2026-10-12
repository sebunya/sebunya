import { getBusinessInfo } from './businessInfo';
import { getStorefrontCopy } from './storefrontCopy';
import { SITE_ORIGIN } from './sitemap';
import { callTool, type Json } from './agentTools';

/**
 * Deterministic first (mandate §3): the questions a shop answers the same way
 * every time are answered from approved data with no model call: where the
 * shop is, hours, delivery terms, how to pay, order tracking, warranty and
 * returns routes, bulk buying, the battery finder, and plain product lookups.
 * The model is reserved for interpretation: trade-offs, suitability, anything
 * ambiguous. Every fact here comes from the same sources the pages render.
 */
export type Intent = 'GREETING' | 'STORE' | 'DELIVERY' | 'PAYMENT' | 'ORDER' | 'POLICY' | 'BULK' | 'BATTERY' | 'PRODUCT' | 'UNKNOWN';

export interface Classification {
  intent: Intent;
  /** True when the answer needs no interpretation and is served without a model call. */
  deterministic: boolean;
  /** Cleaned search text for product and battery lookups. */
  query: string;
}

export interface ProductCard { name: string; url: string; sku: string | null; price_ugx: number | null; availability: string; image: string | null; note?: string }
export interface Link { label: string; url: string }
export interface DeterministicAnswer { intent: Intent; text: string; products: ProductCard[]; links: Link[] }

const PHONE_BRANDS = /\b(tecno|techno|infinix|itel|samsung|nokia|oppo|vivo|realme|iphone|apple|huawei|xiaomi|redmi|pixel|motorola)\b/i;
const BATTERY_CODE = /\b(bl|eb|blp|hb)[- ]?[a-z0-9]{3,8}\b/i;
const PRODUCT_NOUNS = /\b(charger|chargers|cable|cables|power ?banks?|earphones?|earbuds?|headphones?|headset|speaker|flash ?(disk|drive)|memory ?card|sd ?card|micro ?sd|mouse|sound ?card|car charger|type.?c|usb|lightning|micro.?usb|adapter|bluetooth|batter(y|ies)|\d+\s?gb|\d+\s?w\b|\d+\s?mah)/i;
/** Places a customer names when asking whether something can reach them; with "today"/"tomorrow" that is a delivery question. */
const PLACES = /\b(kampala|wakiso|nansana|mukono|entebbe|kira|ntinda|kawempe|makindye|rubaga|lubaga|nakawa|kajjansi|gayaza|bweyogerere|seeta|namugongo|kireka|bukoto|kololo|kisaasi|kyanja|najjera|kitende|jinja|mbarara|gulu|mbale|masaka|lira|arua|fort portal|hoima|soroti|kabale|my (area|place|home|office|location))\b/;
const INTERPRETIVE = /\b(which|best|better|compatible|compatibility|fast.?charg(e|er|ing)?|right for|work(s)? with|fit(s)? my|difference|vs\.?|versus|compare|recommend|suitable|good for|laptop|how (do|does|can|long)|why|explain|should i)\b/i;

export function classify(raw: string): Classification {
  const text = raw.trim().replace(/\s+/g, ' ');
  const t = text.toLowerCase();
  const short = t.length <= 40;
  if (short && /^(hi|hello|hey|yo|good (morning|afternoon|evening)|thanks|thank you|ok(ay)?|cool|sure)\b[!. ]*$/.test(t)) return { intent: 'GREETING', deterministic: true, query: '' };
  if (/\b(track|tracking|status of|where is|where's|wheres)\b[^.?]*\border\b|\border (status|number|ref|reference)\b|\bmy order\b|\bdelivered yet\b|\b(show|check|find|see|open|look up)\b[^.?]*\border\b/.test(t)) return { intent: 'ORDER', deterministic: true, query: '' };
  if (/\b(pay|payment|paid|paying|mobile money|momo|mtn|airtel|pesapal|visa|mastercard|(credit|debit|bank) ?card|card payment|(pay|paying|paid) (by|with|using) (a |my )?card|cash on delivery|refund me|my refund|refund (status|arrive|arrived|when)|pin|otp)\b/.test(t) && !/\b(refund policy|return)\b/.test(t)) return { intent: 'PAYMENT', deterministic: true, query: '' };
  if (/\b(bulk|wholesale|quotation|quote|for (my|the|our) (office|school|shop|company|business))\b/.test(t) || /\b(\d{2,}|fifty|hundred) (power ?banks|chargers|cables|units|pieces|pcs)\b/.test(t)) return { intent: 'BULK', deterministic: true, query: '' };
  if (/\b(warranty|guarantee|returns?|refund|exchange|replace(ment)?|broken|(bought|got|ordered|received) the wrong|wrong (item|product|battery|size|one|colour|color)|stop(s|ped)? working|not working|faulty|fake|genuine|original|verify|verification|authentic|counterfeit|swollen)\b/.test(t)) return { intent: 'POLICY', deterministic: true, query: text };
  if (/\bbatter(y|ies)\b/.test(t) || BATTERY_CODE.test(text)) return { intent: 'BATTERY', deterministic: true, query: batteryQuery(text) };
  if (/\b(deliver|delivery|deliveries|shipping|ship|courier|boda|cut.?off|same.?day|upcountry|how long (to|does|will)|when will (it|i)|receive (it|this|them|my)|bring (it|this|them))\b/.test(t) || (PLACES.test(t) && /\b(today|tomorrow|tonight|by (today|tomorrow|\w+day))\b/.test(t))) return { intent: 'DELIVERY', deterministic: true, query: text };
  if (/\b(where (is|are) (the |your )?(shop|store|you|office)|location|address|directions?|open(ing)?|hours|close|closing|phone number|whatsapp|contact|call you|visit)\b/.test(t)) return { intent: 'STORE', deterministic: true, query: '' };
  const lookup = /\b(do you (have|sell|stock)|have you got|got any|how much|price|cost|cheapest|cheap|under|budget|looking for|i need|i want|buy|available|in stock|show me|any)\b/.test(t);
  if (lookup || PRODUCT_NOUNS.test(t)) return { intent: 'PRODUCT', deterministic: !INTERPRETIVE.test(t), query: productQuery(text) };
  return { intent: 'UNKNOWN', deterministic: false, query: text };
}

/** The phone model or battery code inside a battery question; empty when there is none to search. */
function batteryQuery(text: string): string {
  const code = text.match(BATTERY_CODE);
  if (code) return code[0].toUpperCase().replace(/\s+/g, '-');
  const brand = text.match(new RegExp(`${PHONE_BRANDS.source}[\\s-]*[a-z0-9][a-z0-9 +-]{0,24}`, 'i'));
  if (!brand) return '';
  return brand[0].replace(/\b(battery|batteries|for|my|the|a|please|phone)\b/gi, ' ').replace(/[?.!,]/g, '').replace(/\s+/g, ' ').trim();
}

function productQuery(text: string): string {
  return text
    .replace(/\b(do you (have|sell|stock)|have you got|got any|how much (is|are|does|for)?|what is the price of|price (of|for)|cost of|cheapest|cheap|looking for|i need|i want|i am looking for|show me|any|please|a|an|the|your|you|some|in stock|available|is|are|there|to buy|buy)\b/gi, ' ')
    .replace(/[?.!,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

const structured = (out: Json): Json => (out.structuredContent && typeof out.structuredContent === 'object' ? (out.structuredContent as Json) : {});
const toolTextOf = (out: Json): string => (Array.isArray(out.content) ? (out.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n') : '');

function cardsFromProducts(list: unknown): ProductCard[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 5).map((p) => {
    const x = p as Json;
    return { name: String(x.name ?? ''), url: String(x.url ?? ''), sku: x.sku == null ? null : String(x.sku), price_ugx: x.price_ugx == null ? null : Number(x.price_ugx), availability: String(x.availability ?? ''), image: Array.isArray(x.images) && x.images[0] ? String(x.images[0]) : null };
  }).filter((c) => c.name && c.url.startsWith(SITE_ORIGIN));
}

export async function answerDeterministically(c: Classification): Promise<DeterministicAnswer> {
  const biz = await getBusinessInfo();
  const wa: Link = { label: 'Chat on WhatsApp', url: biz.whatsappUrl };
  const link = (label: string, path: string): Link => ({ label, url: `${SITE_ORIGIN}${path}` });
  switch (c.intent) {
    case 'GREETING':
      return { intent: c.intent, text: 'Hello, you are welcome. Ask me about a product, a price, a battery for your phone, delivery or the shop, and I will check for you. For anything about an order, the Track my order page or WhatsApp is quickest.', products: [], links: [link('Browse the shop', '/shop'), link('Battery finder', '/battery-finder')] };
    case 'STORE': {
      const out = await callTool('store_info', {});
      const s = structured(out);
      const b = biz as { openDays?: string; shopHours?: string; phoneDisplay?: string };
      const text = `We are on the 4th floor of the Zainab Aziza Building on Burton Street, opposite Pioneer Mall and next to Uhuru Restaurant.${b.openDays && b.shopHours ? ` We are open ${b.openDays}, ${b.shopHours}.` : ''}${b.phoneDisplay ? ` Call or WhatsApp us on ${b.phoneDisplay} before you come, if you like.` : ''}`;
      return { intent: c.intent, text, products: [], links: [{ label: 'Open the map', url: String(s.map ?? biz.mapUrl) }, wa] };
    }
    case 'DELIVERY': {
      const out = await callTool('store_info', {});
      const s = structured(out);
      const elsewhere = /\b(mbarara|gulu|jinja|mbale|lira|arua|fort portal|masaka|soroti|hoima|kabale|upcountry|up-country|outside kampala)\b/i.test(c.query);
      const text = `Yes, we deliver. ${String(s.delivery ?? biz.deliveryNote)} An estimated delivery fee for your address is shown at checkout before you pay and confirmed before the rider leaves.${elsewhere ? ' For places outside Kampala and Wakiso, message us on WhatsApp first and we will tell you what is possible.' : ''}`;
      return { intent: c.intent, text, products: [], links: [link('Delivery in Kampala and Wakiso', '/delivery/kampala-wakiso'), wa] };
    }
    case 'PAYMENT': {
      const copy = (await getStorefrontCopy()).payment;
      const text = `You can pay two ways at checkout. ${copy.pesapal.label}: ${copy.pesapal.description} Or ${copy.offline.label.toLowerCase()}: ${copy.offline.description} One thing to know: we never ask for your PIN or OTP in this chat, and I cannot confirm a payment from here. If money left your phone and the order still says pending, send us the order reference on WhatsApp and a person will sort it out.`;
      return { intent: c.intent, text, products: [], links: [link('Payment questions', '/faq'), wa] };
    }
    case 'ORDER':
      return { intent: c.intent, text: 'I cannot open orders from this chat, so your details stay private. The Track my order page shows it with your order reference and the phone number or email you used at checkout. For anything else about an order, message us on WhatsApp and a person will help.', products: [], links: [link('Track my order', '/track-order'), wa] };
    case 'POLICY': {
      if (/\b(fake|genuine|original|verify|verification|authentic|counterfeit)\b/i.test(c.query)) {
        return { intent: c.intent, text: 'Every GoldPlus product has a code under the hologram on the pack. Enter it on the verification page and it tells you straight away. I cannot confirm authenticity in chat; the page is the check. If you think you were sold a fake, please report it so we can follow up.', products: [], links: [link('Verify a product', '/verification'), link('Report a fake', '/support/fake'), wa] };
      }
      return { intent: c.intent, text: 'Sorry to hear that. Warranty cover depends on the product, and our team checks the item before any replacement or refund, so nothing is approved in this chat. The warranty page explains what is covered and the steps, and the returns page covers returns. If you would rather talk to someone, message us on WhatsApp with your order number.', products: [], links: [link('Warranty', '/warranty'), link('Returns', '/returns'), wa] };
    }
    case 'BULK':
      return { intent: c.intent, text: 'For a bulk or business order, the bulk page builds your list from the live catalogue and the quote request sends it to our sales team. The prices I quote here are single-unit prices; the team confirms the bulk price.', products: [], links: [link('Bulk buying', '/bulk'), link('Request a quote', '/quote-request'), wa] };
    case 'BATTERY': {
      if (!c.query) return { intent: c.intent, text: 'Happy to check. Tell me the phone model, for example Tecno Spark 7, or the code printed on the old battery, for example BL-49FT.', products: [], links: [link('Battery finder', '/battery-finder')] };
      const out = await callTool('find_battery', { phone_or_code: c.query });
      const s = structured(out);
      const kind = String(s.kind ?? '');
      const links = [link('Battery finder', '/battery-finder'), wa];
      if (kind === 'DEVICE') {
        const device = (s.device as Json) ?? {};
        const results = Array.isArray(s.results) ? (s.results as Json[]) : [];
        const products: ProductCard[] = results.slice(0, 3).map((r) => ({
          name: String(r.name ?? ''), url: `${SITE_ORIGIN}/products/${String(r.slug ?? '')}`, sku: r.canonicalCode == null ? null : String(r.canonicalCode),
          price_ugx: r.priceUgx == null ? null : Number(r.priceUgx), availability: r.inStock ? 'in_stock' : 'out_of_stock', image: r.imageUrl ? String(r.imageUrl) : null, note: String(r.fitLabel ?? ''),
        })).filter((p) => p.name);
        if (!products.length) return { intent: c.intent, text: `We have not matched a battery to the ${String(device.label ?? c.query)} yet, so I will not guess. Send us the model number on WhatsApp and we will confirm the right one.`, products: [], links };
        const awaiting = results.some((r) => r.fitState === 'AWAITING_VERIFICATION');
        return { intent: c.intent, text: `For the ${String(device.label ?? c.query)} we have ${products.length === 1 ? 'one battery' : `${products.length} batteries`} listed.${awaiting ? ' Where it says "not yet checked", the fit is listed by the supplier; we confirm the fit before you pay.' : ''}`, products, links };
      }
      if (kind === 'AMBIGUOUS_DEVICE' || kind === 'SUGGESTIONS') {
        const devices = Array.isArray(s.devices) ? (s.devices as Json[]).slice(0, 6).map((d) => String(d.label ?? '')) : [];
        return { intent: c.intent, text: `${devices.length ? `${CLARIFY_PHONE} ${devices.join(', ')}.` : 'I could not match that phone.'} The exact model is in Settings under About phone, if you want to check.`, products: [], links };
      }
      if (kind === 'BATTERY') {
        const b = (s.battery as Json) ?? {};
        const products: ProductCard[] = b.name ? [{ name: String(b.name), url: `${SITE_ORIGIN}/products/${String(b.slug ?? '')}`, sku: b.canonicalCode == null ? null : String(b.canonicalCode), price_ugx: b.priceUgx == null ? null : Number(b.priceUgx), availability: b.inStock ? 'in_stock' : 'out_of_stock', image: b.imageUrl ? String(b.imageUrl) : null, note: String(b.fitLabel ?? '') }] : [];
        return { intent: c.intent, text: products.length ? `Found it: battery ${String(b.canonicalCode ?? c.query)}.` : toolTextOf(out), products, links };
      }
      return { intent: c.intent, text: toolTextOf(out) || 'I could not find that battery on the shelf. Try the battery finder, or ask us on WhatsApp with your phone model.', products: [], links };
    }
    case 'PRODUCT': {
      const query = c.query || 'accessories';
      const out = await callTool('search_products', { query, limit: 5 });
      const products = cardsFromProducts(structured(out).products);
      if (!products.length) return { intent: c.intent, text: `No GoldPlus product matched "${query}". Try the product code, fewer words, or have a look through the shop.`, products: [], links: [link('Browse the shop', '/shop'), wa] };
      return { intent: c.intent, text: `${products.length === 1 ? 'Here is what we have' : `Here is what we have, ${products.length} options`} for "${query}". Prices are today's prices and stock is on each card.`, products, links: [link('See all results', `/shop?q=${encodeURIComponent(query)}`)] };
    }
    default:
      return { intent: 'UNKNOWN', text: 'I can help you find a product, check a price or a phone battery, and explain delivery and payment. For anything else, our team is on WhatsApp.', products: [], links: [wa] };
  }
}

/** The one clarifying question the finder asks; a reply to it is the same request, not a new one. */
export const CLARIFY_PHONE = 'Which of these is your phone?';

/**
 * Clarification lineage (mandate §5A.A): the customer's turn is a short reply
 * to the shop's own "which phone?" question in the previous assistant turn,
 * and it routes deterministically (so it costs no model money whatever the
 * client claims). Only then is it read as part of the open request.
 */
export function isClarificationReply(turns: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>, classified: Classification): boolean {
  if (!classified.deterministic || classified.intent !== 'BATTERY') return false;
  const prev = turns.length >= 2 ? turns[turns.length - 2] : undefined;
  const last = turns[turns.length - 1];
  return !!prev && prev.role === 'assistant' && prev.content.includes(CLARIFY_PHONE) && !!last && last.content.length <= 60;
}

/** What the customer sees when paid AI is not available for this turn (mandate §5A.F wording). */
export const SOFT_LIMIT_TEXT = 'I can still help you find products and check delivery. For the more detailed questions, give me a little while and try again, or our team can answer on WhatsApp.';
