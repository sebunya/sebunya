import { createHash } from 'node:crypto';
import { apiBase } from './api';
import { callTool, type Json } from './agentTools';
import type { ProductCard } from './assistantRouter';

/**
 * Goldie's answer memory, web side: turn a question into a stable key, decide
 * whether it is general enough to remember, and re-check the facts of a
 * remembered answer before serving it (every product it names must still be
 * sellable at the same price; otherwise the model is asked again).
 *
 * Normalising, not embedding: no extra model or vector store to depend on.
 * Lower case, words only, shop synonyms folded ("techno" is Tecno, "type c" is
 * usb-c, "power bank" is powerbank), filler words dropped, plurals folded, the
 * rest sorted. "Which charger for my iPhone 13?" and "iphone 13 chargers"
 * meet at the same key; "cheapest" and "best" stay apart because they ask for
 * different answers.
 */
const SYNONYMS: Array<[RegExp, string]> = [
  [/\btechno\b/g, 'tecno'], [/\b(power ?banks?|powerbanks?)\b/g, 'powerbank'], [/\b(type[ -]?c|usb[ -]?c|usbc)\b/g, 'usbc'],
  [/\b(earbuds?|earphones?|headphones?|headsets?|airpods?)\b/g, 'earphones'], [/\b(flash ?(disk|drive)s?|pendrives?|usb sticks?)\b/g, 'flashdisk'],
  [/\b(memory ?cards?|sd ?cards?|micro ?sd)\b/g, 'memorycard'], [/\b(chargers?|adapters?|plugs?)\b/g, 'charger'], [/\b(cables?|cords?|wires?)\b/g, 'cable'],
  [/\b(cheap|cheapest|affordable|lowest price)\b/g, 'cheapest'], [/\b(best|good|recommended?|top)\b/g, 'best'], [/\bi ?phone\b/g, 'iphone'],
  [/\b(fast|quick|rapid) ?charg(e|er|ing)\b/g, 'fastcharge'], [/(\d+)\s*(w|watt|watts)\b/g, '$1w'], [/(\d+)\s*mah\b/g, '$1mah'], [/(\d+)\s*(gb|gig|gigs)\b/g, '$1gb'],
];
const STOP = new Set('a an the i me my mine you your we our us is are am be do does did have has had can could will would should shall may might please kindly which what whats what\'s who how where when there here this that these those it its for to of on in at by with and or but so if any some get got need want looking look find buy sell show tell give know about like just also really very much many one ones thing things from into up out sir madam boss hello hi hey'.split(' '));

export function normalizeQuestion(raw: string): string {
  let t = ` ${raw.toLowerCase()} `;
  for (const [re, to] of SYNONYMS) t = t.replace(re, to);
  const words = t.replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)
    .map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .filter((w) => !STOP.has(w));
  return [...new Set(words)].sort().join(' ');
}

export const questionKey = (raw: string) => createHash('sha256').update(`goldie-memory:v1:${normalizeQuestion(raw)}`).digest('hex');

/** A question worth remembering: general shopping, nothing personal, enough words to mean something. */
export function rememberableQuestion(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 8 || t.length > 300) return false;
  if (/(?:\+?256|0)\s?7\d{2}[\s-]?\d{3}[\s-]?\d{3}|[\w.+-]+@[\w-]+\.[\w.-]+|\bGP-[A-Z0-9]/i.test(t)) return false;
  if (t.split(/\s+/).length > 16 || /\b(ignore|instructions?|rules?|pretend|prompt|system|jailbreak|act as|you are now)\b/i.test(t)) return false;
  if (/\b(my order|i paid|i ordered|i bought|refund|deliver(ed|y) (to|yet)|my account|my points|cancel|complain|broken|not working|wrong item)\b/i.test(t)) return false;
  // Short, common questions only: they repeat (so memory pays), and a long question stuffed with instructions
  // can never become an answer another customer receives.
  const words = normalizeQuestion(t).split(' ').filter(Boolean).length;
  return words >= 2 && words <= 10;
}

export interface Remembered { id: string; answer: string; products: Array<{ slug: string; price_ugx: number | null; availability: string }> }

async function call<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${apiBase}/internal/assistant${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(1500) });
    const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T } | null;
    return res.ok && json?.success ? (json.data ?? null) : null;
  } catch { return null; }
}

const slugOf = (url: string) => url.match(/\/products\/([a-z0-9-]+)/)?.[1] ?? '';
const SELLABLE = new Set(['in_stock', 'low_stock']);

/**
 * A remembered answer whose facts still hold, with fresh product cards; null on a miss or a stale answer
 * (a stale one is counted, so the team can see answers the shelf has outgrown).
 */
export async function recall(question: string): Promise<{ id: string; text: string; products: ProductCard[] } | null> {
  if (!rememberableQuestion(question)) return null;
  const hit = await call<Remembered>('/memory/lookup', { key: questionKey(question) });
  if (!hit) return null;
  const live = await Promise.all(hit.products.map(async (p) => {
    const out = await callTool('get_product', { slug: p.slug }).catch(() => null) as Json | null;
    const prod = ((out?.structuredContent as Json | undefined)?.product ?? null) as Json | null;
    return prod ? { prod, snap: { slug: p.slug, price_ugx: prod.price_ugx == null ? null : Number(prod.price_ugx), availability: String(prod.availability ?? '') } } : null;
  }));
  const holds = hit.products.every((r, i) => {
    const l = live[i]?.snap;
    return !!l && l.price_ugx === r.price_ugx && SELLABLE.has(l.availability);
  });
  if (!holds) { void call('/memory/' + hit.id + '/stale', {}); return null; }
  void call('/memory/' + hit.id + '/served', {});
  const products: ProductCard[] = live.map((l) => {
    const x = l!.prod;
    return { id: typeof x.id === 'string' ? x.id : null, name: String(x.name ?? ''), url: String(x.url ?? ''), sku: x.sku == null ? null : String(x.sku), price_ugx: x.price_ugx == null ? null : Number(x.price_ugx), availability: String(x.availability ?? ''), image: Array.isArray(x.images) && x.images[0] ? String(x.images[0]) : null, category: x.category == null ? null : String(x.category) };
  });
  return { id: hit.id, text: hit.answer, products };
}

/** After a paid answer: remember it with the products it showed, as they were. Fire-and-forget. */
export function remember(question: string, answer: string, intent: string, products: ProductCard[]): void {
  if (!rememberableQuestion(question)) return;
  const snaps = products.slice(0, 5).map((p) => ({ slug: slugOf(p.url), price_ugx: p.price_ugx, availability: p.availability })).filter((p) => p.slug);
  void call('/memory/remember', { key: questionKey(question), question, answer, intent, products: snaps });
}
