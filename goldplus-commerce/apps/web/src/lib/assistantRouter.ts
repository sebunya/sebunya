import { getBusinessInfo } from './businessInfo';
import { getStorefrontCopy } from './storefrontCopy';
import { SITE_ORIGIN } from './sitemap';
import { callTool, type Json } from './agentTools';
import { TEAM_HANDOVER_PATH } from './goldieLinks';
import { ORDER_REF, findContact, findOrderRef, myLoyalty, myOrders, quoteDelivery, requestCallback, trackOrder, type CareContext } from './goldieCare';

/**
 * Deterministic first (mandate §3): the questions a shop answers the same way
 * every time are answered from approved data with no model call: where the
 * shop is, hours, delivery terms, how to pay, order tracking, warranty and
 * returns routes, bulk buying, the battery finder, and plain product lookups.
 * The model is reserved for interpretation: trade-offs, suitability, anything
 * ambiguous. Every fact here comes from the same sources the pages render.
 */
export type Intent = 'IDENTITY' | 'LOYALTY' | 'CALLBACK' | 'GREETING' | 'STORE' | 'DELIVERY' | 'PAYMENT' | 'ORDER' | 'POLICY' | 'BULK' | 'BATTERY' | 'PRODUCT' | 'UNKNOWN';

export interface Classification {
  intent: Intent;
  /** True when the answer needs no interpretation and is served without a model call. */
  deterministic: boolean;
  /** Cleaned search text for product and battery lookups. */
  query: string;
}

/** A product card the widget renders. `id` is the catalogue id the cart accepts; the widget shows
 *  "Add to cart" only when it is present and the item is in stock with a price. */
export interface ProductCard { id: string | null; name: string; url: string; sku: string | null; price_ugx: number | null; availability: string; image: string | null; category: string | null; note?: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const cardId = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null);
export interface Link { label: string; url: string }
export interface DeterministicAnswer { intent: Intent; text: string; products: ProductCard[]; links: Link[] }

const PHONE_BRANDS = /\b(tecno|techno|infinix|itel|samsung|nokia|oppo|vivo|realme|iphone|apple|huawei|xiaomi|redmi|pixel|motorola)\b/i;
// A battery code always has a digit (BL-5C, BL-44E1F, EB-BG973ABU, HB396285ECW): without that rule "black" and
// "bluetooth" were read as battery codes ("bluetooth speaker" got the battery finder).
const BATTERY_CODE = /\b(bl|eb|blp|hb)[- ]?(?=[a-z]*\d)[a-z0-9]{2,10}\b/i;
const PRODUCT_NOUNS = /\b(charger|chargers|cable|cables|power ?banks?|earphones?|earbuds?|headphones?|headset|speaker|flash ?(disk|drive)|memory ?card|sd ?card|micro ?sd|mouse|sound ?card|car charger|type.?c|usb|lightning|micro.?usb|adapter|bluetooth|batter(y|ies)|\d+\s?gb|\d+\s?w\b|\d+\s?mah)/i;
/** Places a customer names when asking whether something can reach them; with "today"/"tomorrow" that is a delivery question. */
const PLACES = /\b(kampala|wakiso|nansana|mukono|entebbe|kira|ntinda|kawempe|makindye|rubaga|lubaga|nakawa|kajjansi|gayaza|bweyogerere|seeta|namugongo|kireka|bukoto|kololo|kisaasi|kyanja|najjera|kitende|jinja|mbarara|gulu|mbale|masaka|lira|arua|fort portal|hoima|soroti|kabale|my (area|place|home|office|location))\b/;
/** Asking for a person, not a product: "talk to someone", "customer care", "an agent", "a real person". */
const WANTS_PERSON = /\b((talk|speak|chat) (to|with) (a |an |the |your |some )?(person|human|someone|somebody|agent|staff|manager|team|owner|customer (care|service))|(customer|client) (care|service|support)|real person|human (agent|being)|(a|an) (agent|attendant|human))\b/;
/** Asking for help in general (an order, a payment, a fault each have their own route above): never a product search. */
const WANTS_HELP = /\b(support|help|assist(ance)?|complain(t|ts|ing)?|problem|issue|query|inquiry|enquiry|disappointed|unhappy)\b/;
/** Phrases that say "I am shopping" on their own, with no product named. */
const SHOPPING = /\b(do you (have|sell|stock)|have you got|got any|how much|price|cost|cheapest|in stock|available)\b/;
const INTERPRETIVE = /\b(choos(e|ing)|pick|advice|advise|suggest|under|below|less than|\d+\s?k\b|which|best|better|compatible|compatibility|fast.?charg(e|er|ing)?|right for|work(s)? with|fit(s)? my|difference|vs\.?|versus|compare|recommend|suitable|good for|laptop|how (do|does|can|long)|why|explain|should i)\b/i;

export function classify(raw: string): Classification {
  const text = raw.trim().replace(/\s+/g, ' ');
  const t = text.toLowerCase();
  const short = t.length <= 40;
  // "Are you a real person?": always the same honest answer, never left to the model.
  if (/\b(are you (a |an )?(real|human|person|people|bot|robot|machine|computer|ai)|is (this|it|goldie) (a )?(real person|human|person|bot|robot|machine)|am i (talking|chatting|speaking|texting) (to|with) (a )?(real person|real|human|person|bot|robot|machine|someone)|who am i (talking|chatting|speaking) (to|with)|who are you|what are you)\b/.test(t)) return { intent: 'IDENTITY', deterministic: true, query: '' };
  if (short && /^(hi|hello|hey|yo|good (morning|afternoon|evening)|ok(ay)?|cool|sure)\b[!. ]*$/.test(t)) return { intent: 'GREETING', deterministic: true, query: t };
  // Thanks in its common forms (never worth a paid answer): "thank you so much", "ok thanks", "webale nnyo", "asante sana".
  if (short && /^(ok(ay)?[ ,]*)?(thanks?|thank you|thx|webale|weebale|mwebale|asante)( (so|very) much| a lot| nnyo| sana| dear| goldie| boss)*[!. 🙏]*$/u.test(t)) return { intent: 'GREETING', deterministic: true, query: t };
  // Someone asking for a person gets the team (a callback task; on WhatsApp the verified number is enough).
  if (WANTS_PERSON.test(t)) return { intent: 'CALLBACK', deterministic: true, query: text };
  if (/\b(call me( back)?|phone me|ring me|give me a call|can (someone|somebody|you|a person) (call|phone|ring)|i want (someone|somebody|a person) to call|call back)\b/.test(t)) return { intent: 'CALLBACK', deterministic: true, query: text };
  if (ORDER_REF.test(text)) return { intent: 'ORDER', deterministic: true, query: '' };
  if (/\b(my )?(loyalty|reward points|my points|points balance|how many points|my tier|tier|friends ?(&|and) ?family (points|rewards))\b/.test(t) && !/\b(charging|power) points?\b/.test(t)) return { intent: 'LOYALTY', deterministic: true, query: '' };
  if (/\b(track|tracking|status of|where is|where's|wheres)\b[^.?]*\border\b|\border (status|number|ref|reference)\b|\bmy order\b|\bdelivered yet\b|\b(show|check|find|see|open|look up)\b[^.?]*\border\b/.test(t)
    || /\b(i )?(ordered|bought|paid for)\b[^.?]*\b(where|when|not (yet )?(come|arrived|received|delivered)|still waiting)\b|\bmy (package|parcel|delivery)\b/.test(t)) return { intent: 'ORDER', deterministic: true, query: '' };
  if (/\b(pay|payment|paid|paying|mobile money|momo|mtn|airtel|pesapal|visa|mastercard|(credit|debit|bank) ?card|card payment|(pay|paying|paid) (by|with|using) (a |my )?card|cash on delivery|refund me|my refund|refund (status|arrive|arrived|when)|pin|otp)\b/.test(t) && !/\b(refund policy|return)\b/.test(t)) return { intent: 'PAYMENT', deterministic: true, query: '' };
  if (/\b(bulk|wholesale|quotation|quote|for (my|the|our) (office|school|shop|company|business))\b/.test(t) || /\b(\d{2,}|fifty|hundred) (power ?banks|chargers|cables|units|pieces|pcs)\b/.test(t)) {
    // Items AND numbers named: the model searches the shelf, confirms the list and files the quote. Otherwise ask.
    const named = /\b(\d{2,}|fifty|hundred|dozen)\b/.test(t) && PRODUCT_NOUNS.test(t);
    return { intent: 'BULK', deterministic: !named, query: '' };
  }
  if (/\b(warranty|guarantee|returns?|refund|exchange|replace(ment)?(?!\s+batter)|broken|(bought|got|ordered|received) the wrong|wrong (item|product|battery|size|one|colour|color)|stop(s|ped)? working|not working|faulty|fake|genuine|original|verify|verification|authentic|counterfeit|swollen|not charging|(doesn'?t|does not|won'?t|will not|can'?t|cannot) (charge|work|turn on|switch on|hold charge)|spoilt|spoiled|dead|died)\b/.test(t)
    // "Do you have original iPhone chargers?" is shopping, not a fake-product check.
    && !(/\b(do you (have|sell|stock)|have you got|how much|price|cost|i (want|need))\b/.test(t) && PRODUCT_NOUNS.test(t) && !/\b(not|fake|counterfeit|broken|faulty|spoilt|dead|swollen|return|refund|warranty)\b/.test(t))) return { intent: 'POLICY', deterministic: true, query: text };
  if (/\bbatter(y|ies)\b/.test(t) || BATTERY_CODE.test(text)) return { intent: 'BATTERY', deterministic: true, query: batteryQuery(text) };
  if (/\b(deliver|delivery|deliveries|shipping|ship|courier|boda|cut.?off|same.?day|upcountry|how long (to|does|will)|when will (it|i)|receive (it|this|them|my)|bring (it|this|them))\b/.test(t) || (PLACES.test(t) && /\b(today|tomorrow|tonight|by (today|tomorrow|\w+day))\b/.test(t))) return { intent: 'DELIVERY', deterministic: true, query: text };
  if (/\b(where (is|are) (the |your )?(shop|store|you|office)|location|address|directions?|open(ing)?|hours|close|closing|phone number|whatsapp|contact|call you|visit|your (number|phone|contacts?))\b/.test(t)) return { intent: 'STORE', deterministic: true, query: '' };
  // A product is searched without the model only when the message names one (a product word, a phone brand, a battery
  // code, a size) or asks a plain shopping question. "I want support", "I need help", "any update?" are not searches:
  // 2026-10-14, "I want support" was answered "I don't see 'support' on our shelf".
  if (/\b(what (do|can) (you|i) (sell|buy|get)|what (products|items) do you|(your|a) (catalogue|catalog|price ?list|products? list))\b/.test(t)) return { intent: 'UNKNOWN', deterministic: false, query: text };
  const named = PRODUCT_NOUNS.test(t) || PHONE_BRANDS.test(t) || BATTERY_CODE.test(text);
  if (!named && WANTS_HELP.test(t)) return { intent: 'UNKNOWN', deterministic: false, query: text };
  if (named || SHOPPING.test(t)) return { intent: 'PRODUCT', deterministic: !INTERPRETIVE.test(t), query: productQuery(text) };
  // "I want…", "I need…", "looking for…" with nothing recognisable named: the model reads it (and searches if it is a product).
  if (/\b(cheap|under|budget|looking for|i need|i want|buy|show me|any)\b/.test(t)) return { intent: 'PRODUCT', deterministic: false, query: productQuery(text) };
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
    // Luganda / Swahili "I want", "give me", "please" (the product word itself is usually English).
    .replace(/\b(nkwagala|njagala|nnyagala|mpa|mpaayo|nsaba|ninataka|nataka|nipe|tafadhali)\b/gi, ' ')
    // "for my phone" / "for my device" says nothing the search can use (the finder asks which phone).
    .replace(/\bfor (my|a|the) (phone|device|handset|mobile)\b/gi, ' ')
    .replace(/\b(what('?s| is)?|do you (have|sell|stock)|have you got|got any|how much (is|are|does|for)?|what is the price of|price (of|for)|cost of|cheapest|cheap|looking for|i need|i want|i am looking for|show me|any|please|a|an|the|your|you|some|in stock|available|is|are|there|to buy|buy)\b/gi, ' ')
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
    return { id: cardId(x.id), name: String(x.name ?? ''), url: String(x.url ?? ''), sku: x.sku == null ? null : String(x.sku), price_ugx: x.price_ugx == null ? null : Number(x.price_ugx), availability: String(x.availability ?? ''), image: Array.isArray(x.images) && x.images[0] ? String(x.images[0]) : null, category: x.category == null ? null : String(x.category) };
  }).filter((c) => c.name && c.url.startsWith(SITE_ORIGIN));
}

/** What a care answer needs: who is asking (session, address) and the conversation (for an order reference and contact typed earlier). */
export interface CareInput { care: CareContext; turns: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }> }

export async function answerDeterministically(c: Classification, ci?: CareInput): Promise<DeterministicAnswer> {
  const biz = await getBusinessInfo();
  const wa: Link = { label: 'Chat on WhatsApp', url: biz.whatsappUrl };
  const link = (label: string, path: string): Link => ({ label, url: `${SITE_ORIGIN}${path}` });
  // Opens the in-chat "pass this to the team" form (the panel intercepts this address); without the panel it is the support page.
  const team: Link = { label: 'Email the team', url: `${SITE_ORIGIN}${TEAM_HANDOVER_PATH}` };
  switch (c.intent) {
    case 'IDENTITY':
      return { intent: c.intent, text: "I'm Goldie, the GoldPlus personal shopper. I'm virtual, not a person: I answer from what is on our shelf and in our shop information. If you would rather talk to someone from the shop, they are on WhatsApp, or I can email them this chat.", products: [], links: [wa, team] };
    case 'GREETING':
      if (/\b(thanks|thank you|webale|asante)\b/.test(c.query)) return { intent: c.intent, text: 'You are most welcome. Thank you for choosing GoldPlus. If anything else comes up, I am right here.', products: [], links: [] };
      if (/^(ok(ay)?|cool|sure)\b/.test(c.query)) return { intent: c.intent, text: 'Alright. Anything else I can check for you?', products: [], links: [] };
      return { intent: c.intent, text: 'Hello, you are welcome. Tell me what you are looking for, a charger, a cable, a power bank or a battery for your phone, and I will check the shelf for you.', products: [], links: [link('Browse the shop', '/shop'), link('Battery finder', '/battery-finder')] };
    case 'STORE': {
      const out = await callTool('store_info', {});
      const s = structured(out);
      const b = biz as { openDays?: string; shopHours?: string; phoneDisplay?: string };
      const text = `We are on the 4th floor of the Zainab Aziza Building on Burton Street, opposite Pioneer Mall and next to Uhuru Restaurant.${b.openDays && b.shopHours ? ` We are open ${b.openDays}, ${b.shopHours}.` : ''}${b.phoneDisplay ? ` Call or WhatsApp us on ${b.phoneDisplay} before you come and we will have it ready.` : ''}`;
      return { intent: c.intent, text, products: [], links: [{ label: 'Open the map', url: String(s.map ?? biz.mapUrl) }, wa] };
    }
    case 'DELIVERY': {
      const out = await callTool('store_info', {});
      const s = structured(out);
      const elsewhere = /\b(mbarara|gulu|jinja|mbale|lira|arua|fort portal|masaka|soroti|hoima|kabale|upcountry|up-country|outside kampala)\b/i.test(c.query);
      // A named place: the real quote from the one quoting service, not a general sentence.
      const place = c.query.toLowerCase().match(PLACES)?.[0];
      if (ci && place && !/^my /.test(place)) {
        const q = await quoteDelivery(place.replace(/\b\w/g, (m) => m.toUpperCase()), ci.care);
        if (q.ok) return { intent: c.intent, text: q.text, products: [], links: [...q.links, wa] };
      }
      const text = `Yes, we deliver. ${String(s.delivery ?? biz.deliveryNote)} An estimated delivery fee for your address is shown at checkout before you pay and confirmed before the rider leaves.${elsewhere ? ' For places outside Kampala and Wakiso, message us on WhatsApp first and we will tell you what is possible.' : ''}`;
      return { intent: c.intent, text, products: [], links: [link('Delivery in Kampala and Wakiso', '/delivery/kampala-wakiso'), wa] };
    }
    case 'PAYMENT': {
      const copy = (await getStorefrontCopy()).payment;
      const text = `You can pay two ways at checkout. ${copy.pesapal.label}: ${copy.pesapal.description} Or ${copy.offline.label.toLowerCase()}: ${copy.offline.description} One thing to know: we never ask for your PIN or OTP in this chat, and I cannot confirm a payment from here. If money left your phone and the order still says pending, send us the order reference on WhatsApp and a person will sort it out.`;
      return { intent: c.intent, text, products: [], links: [link('Payment questions', '/faq'), wa] };
    }
    case 'ORDER': {
      if (!ci) return { intent: c.intent, text: 'Track my order shows your order with the reference and the phone number or email you used at checkout. For anything else about the order, the team will sort it out on WhatsApp or by email.', products: [], links: [link('Track my order', '/track-order'), wa, team] };
      const ref = findOrderRef(ci.turns), contact = findContact(ci.turns) ?? (ci.care.verifiedPhone ? `+${ci.care.verifiedPhone}` : null);
      if (ref && contact) { const a = await trackOrder(ref, contact, ci.care); return { intent: c.intent, text: a.text, products: [], links: [...a.links, ...(a.ok ? [] : [wa])] }; }
      if (!ref && (ci.care.bearer || ci.care.verifiedPhone)) { const a = await myOrders(ci.care); return { intent: c.intent, text: a.text, products: [], links: a.links }; }
      if (ref) return { intent: c.intent, text: `Thanks, I have ${ref}. To keep your order private, what is the phone number or email you used at checkout?`, products: [], links: [] };
      return { intent: c.intent, text: 'Send me your order reference (it starts with GP- and is in your order SMS or email) and the phone number or email you used at checkout, and I will check it now. If you are signed in, I can see your orders straight away.', products: [], links: [link('Sign in', '/login?returnTo=/account/orders')] };
    }
    case 'CALLBACK': {
      if (!ci) return { intent: c.intent, text: 'Leave your number with the team on WhatsApp and someone will call you.', products: [], links: [wa] };
      const phone = findContact(ci.turns) ?? (ci.care.verifiedPhone ? `+${ci.care.verifiedPhone}` : null);
      if (!phone || /@/.test(phone)) return { intent: c.intent, text: 'Of course. Which number should the team call you on?', products: [], links: [] };
      const reason = ci.turns.filter((t) => t.role === 'user').map((t) => t.content).slice(-3).join(' / ').slice(0, 180);
      const a = await requestCallback({ phone, reason }, ci.care);
      return { intent: c.intent, text: a.text, products: [], links: a.links };
    }
    case 'LOYALTY': {
      if (!ci) return { intent: c.intent, text: 'Your points, tier and what expires next are on your rewards page once you sign in.', products: [], links: [link('My rewards', '/account/loyalty')] };
      const a = await myLoyalty(ci.care);
      return { intent: c.intent, text: a.text, products: [], links: a.links };
    }
    case 'POLICY': {
      if (/\b(fake|genuine|original|verify|verification|authentic|counterfeit)\b/i.test(c.query)) {
        return { intent: c.intent, text: 'Every GoldPlus product has a code under the hologram on the pack. Enter it on the verification page and it tells you straight away. That page is the check, not this chat. If you think you were sold a fake, report it and we will follow up.', products: [], links: [link('Verify a product', '/verification'), link('Report a fake', '/support/fake'), wa] };
      }
      return { intent: c.intent, text: 'Thanks for letting us know, and sorry about the trouble. The team checks the item first, then agrees the replacement or refund with you; nothing is approved in this chat. The warranty page shows what is covered and the steps. The quickest way is WhatsApp with your order number, or I can email the team this chat and they will get back to you.', products: [], links: [link('Warranty', '/warranty'), link('Returns', '/returns'), wa, team] };
    }
    case 'BULK':
      return { intent: c.intent, text: "Good, we do bulk, and we look after our resellers. Tell me which items and roughly how many units of each, and I'll put the quote together for you right here. Prices in this chat are single-unit prices; the sales team confirms your bulk price.", products: [], links: [link('Bulk buying', '/bulk'), wa] };
    case 'BATTERY': {
      if (!c.query) return { intent: c.intent, text: "Let's confirm the right battery. Send me the phone's exact model, for example Tecno Spark 7, or the code on the old battery, for example BL-49FT.", products: [], links: [link('Battery finder', '/battery-finder')] };
      const out = await callTool('find_battery', { phone_or_code: c.query });
      const s = structured(out);
      const kind = String(s.kind ?? '');
      const links = [link('Battery finder', '/battery-finder'), wa];
      if (kind === 'DEVICE') {
        const device = (s.device as Json) ?? {};
        const results = Array.isArray(s.results) ? (s.results as Json[]) : [];
        const products: ProductCard[] = results.slice(0, 3).map((r) => ({
          id: cardId(r.productId), category: null, name: String(r.name ?? ''), url: `${SITE_ORIGIN}/products/${String(r.slug ?? '')}`, sku: r.canonicalCode == null ? null : String(r.canonicalCode),
          price_ugx: r.priceUgx == null ? null : Number(r.priceUgx), availability: r.inStock ? 'in_stock' : 'out_of_stock', image: r.imageUrl ? String(r.imageUrl) : null, note: String(r.fitLabel ?? ''),
        })).filter((p) => p.name);
        if (!products.length) return { intent: c.intent, text: `We haven't confirmed a battery for the ${String(device.label ?? c.query)} yet, so I won't guess. Send us the model on WhatsApp and the team will confirm the right one.`, products: [], links };
        const awaiting = results.some((r) => r.fitState === 'AWAITING_VERIFICATION');
        return { intent: c.intent, text: `For the ${String(device.label ?? c.query)} we have ${products.length === 1 ? 'one battery' : `${products.length} batteries`} listed.${awaiting ? ' Where it says "not yet checked", the fit is listed by the supplier; we confirm the fit before you pay.' : ''}`, products, links };
      }
      if (kind === 'AMBIGUOUS_DEVICE' || kind === 'SUGGESTIONS') {
        const devices = Array.isArray(s.devices) ? (s.devices as Json[]).slice(0, 6).map((d) => String(d.label ?? '')) : [];
        if (kind === 'AMBIGUOUS_DEVICE' && devices.length) return { intent: c.intent, text: `${CLARIFY_PHONE} ${devices.join(', ')}. The exact model is in Settings under About phone, if you want to check.`, products: [], links };
        // SUGGESTIONS: nothing matched the phone the customer named; the finder offers its nearest names. Say so plainly, never pretend one of them is the phone.
        return { intent: c.intent, text: `I do not have the ${c.query} on our battery list yet, so I will not guess a fit.${devices.length ? ` The closest names we do have are ${devices.join(', ')}; if yours is one of those, tell me which.` : ''} Otherwise send us the phone model on WhatsApp and we will check for you.`, products: [], links };
      }
      if (kind === 'BATTERY') {
        const b = (s.battery as Json) ?? {};
        const products: ProductCard[] = b.name ? [{ id: cardId(b.productId), category: null, name: String(b.name), url: `${SITE_ORIGIN}/products/${String(b.slug ?? '')}`, sku: b.canonicalCode == null ? null : String(b.canonicalCode), price_ugx: b.priceUgx == null ? null : Number(b.priceUgx), availability: b.inStock ? 'in_stock' : 'out_of_stock', image: b.imageUrl ? String(b.imageUrl) : null, note: String(b.fitLabel ?? '') }] : [];
        return { intent: c.intent, text: products.length ? `Found it: battery ${String(b.canonicalCode ?? c.query)}.` : toolTextOf(out), products, links };
      }
      return { intent: c.intent, text: toolTextOf(out) || 'I could not find that battery on the shelf. Try the battery finder, or ask us on WhatsApp with your phone model.', products: [], links };
    }
    case 'PRODUCT': {
      const query = c.query || 'accessories';
      const out = await callTool('search_products', { query, limit: 5 });
      const products = cardsFromProducts(structured(out).products);
      // Never a dead end: ask the one thing that finds it (what it is for, which device), and offer a person.
      if (!products.length) return { intent: c.intent, text: `I couldn't find "${query}" by that name. What is it for, or which phone or device should it work with? Tell me and I'll find the closest match. You can also message the team on WhatsApp.`, products: [], links: [link('Browse the shop', '/shop'), wa] };
      return { intent: c.intent, text: `${products.length === 1 ? 'We have one that matches' : `We have ${products.length} that match`}. Today's price and stock are with each one${products.length > 1 ? '; tell me what it is for and I will say which one fits' : ''}.`, products, links: [link('See all results', `/shop?q=${encodeURIComponent(query)}`)] };
    }
    default:
      return { intent: 'UNKNOWN', text: 'I can find a product, check a price or a battery for your phone, and explain delivery and payment. For anything else, the team is on WhatsApp, or I can email them this chat.', products: [], links: [wa, team] };
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
export const SOFT_LIMIT_TEXT = 'I can still find products and check delivery for you. For the more detailed questions, give me a little while and ask again, or the team can answer on WhatsApp.';
