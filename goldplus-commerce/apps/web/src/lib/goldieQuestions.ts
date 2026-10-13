/**
 * The questions Goldie offers as chips: a short LABEL the shopper sees and
 * a full ASK that is sent. The ask always names its subject (the product,
 * the phone, the category), because the conversation reaches the server
 * without the page it came from. "Will it fit my phone?" alone reached the
 * paid model with no idea which product was meant; "Will the Replacement
 * Battery GP-39LT9 fit my Samsung Galaxy A12?" is answered free from the
 * battery finder. tests/unit/GoldieQuestions.test.ts pins the routing:
 * fit and delivery asks are deterministic (no model call), and none is
 * ever UNKNOWN.
 *
 * Shared by the product page's inline chips (AskGoldie.astro), the
 * launcher's teaser and the panel's starters.
 */
export interface GoldieQuestion { label: string; ask: string }

/** "GoldPlus Replacement Battery A03 CORE — fits the A03 Core" -> "Replacement Battery A03 CORE";
 *  "GoldPlus GP-P06 10000mAh Compact Power Bank, 22.5W, ..." -> "GP-P06 10000mAh Compact Power Bank". */
export function shortProductName(name: string): string {
  return name.replace(/^GoldPlus\s+/i, '').split(/\s[—(]|,/)[0].trim();
}

/** Whether today's delivery run is still possible, from the shop's cutoff hour in Kampala time. */
export function todayStillOpen(cutoffHour: number, now: Date = new Date()): boolean {
  let hour: number;
  try { hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Kampala' }).format(now)); } catch { hour = now.getUTCHours() + 3; }
  return hour < cutoffHour;
}

/** The delivery question, honest about the cutoff: "today" only while today is possible. */
export function deliveryQuestion(todayOpen: boolean, subject = ''): GoldieQuestion {
  const what = subject ? `the ${subject}` : 'it';
  return todayOpen
    ? { label: 'Can it come today?', ask: `Can you deliver ${what} today?` }
    : { label: 'When can it reach me?', ask: `When can you deliver ${what}?` };
}

const mine = (phone: string) => (phone ? `my ${phone}` : 'my phone');
/** The product's short name with its kind added only when the name does not already say it. */
const withNoun = (short: string, noun: string, has: RegExp) => (has.test(short) ? short : `${short} ${noun}`);

/** The two questions a shopper has on a product page, by product kind. */
export function productQuestions(p: { name: string; isBattery: boolean; phone: string; todayOpen: boolean }): GoldieQuestion[] {
  const short = shortProductName(p.name) || p.name;
  const n = p.name;
  const delivery = deliveryQuestion(p.todayOpen, short);
  if (p.isBattery || /batter/i.test(n)) {
    const subject = withNoun(short, 'battery', /batter/i);
    return [{ label: `Will it fit ${mine(p.phone)}?`, ask: `Will the ${subject} fit ${mine(p.phone)}?` }, delivery];
  }
  // Power banks before chargers and cables: many are named "... with Built-in USB-C and Lightning Cables".
  if (/power ?bank/i.test(n)) return [{ label: 'How many charges will I get?', ask: `How many phone charges will I get from the ${withNoun(short, 'power bank', /power ?bank/i)}?` }, delivery];
  if (/charger|cable/i.test(n)) return [{ label: 'Which phones does it work with?', ask: `Which phones does the ${short} work with?` }, delivery];
  if (/earphone|earbud|headphone|headset|speaker|bluetooth/i.test(n)) return [{ label: 'Is it good for calls?', ask: `Is the ${withNoun(short, 'earphones', /earphone|earbud|headphone|headset|speaker/i)} good for calls?` }, delivery];
  if (/memory card|micro ?sd|flash/i.test(n)) return [{ label: `Will it work in ${mine(p.phone)}?`, ask: `Will the ${withNoun(short, 'memory card', /memory card|micro ?sd|flash/i)} work in ${mine(p.phone)}?` }, delivery];
  return [{ label: 'Tell me more about this one', ask: `Tell me more about the ${short}. Is it in stock?` }, delivery];
}

export type PageKey = 'batteries' | 'chargers' | 'power-banks' | 'cables' | 'audio' | 'storage' | 'delivery' | 'guide' | 'home';

/** The two chips for a category, guide or home page. */
export function pageQuestions(key: PageKey, phone: string, todayOpen: boolean): GoldieQuestion[] {
  const my = mine(phone);
  const delivery = deliveryQuestion(todayOpen);
  switch (key) {
    case 'batteries': return [{ label: phone ? `Battery for my ${phone}` : 'Find a battery for my phone', ask: `Find a battery for ${my}` }, { label: 'How much is a battery?', ask: phone ? `How much is a battery for ${my}?` : 'How much is a replacement battery?' }];
    case 'chargers': return [{ label: `Which charger for ${my}?`, ask: `Which charger is right for ${my}?` }, delivery];
    case 'power-banks': return [{ label: 'Which size do I need?', ask: 'Which power bank size do I need?' }, delivery];
    case 'cables': return [{ label: `Which cable for ${my}?`, ask: `Which charging cable fits ${my}?` }, delivery];
    case 'audio': return [{ label: 'Best for calls?', ask: 'Which earphones are best for calls?' }, delivery];
    case 'storage': return [{ label: `Which card for ${my}?`, ask: `Which memory card works in ${my}?` }, delivery];
    case 'delivery': return [{ label: 'Deliver to my area?', ask: 'Do you deliver to my area?' }, { label: 'How much is delivery?', ask: 'How much is delivery?' }];
    case 'guide': return [{ label: `Find a battery for ${my}`, ask: `Find a battery for ${my}` }, { label: `Which charger for ${my}?`, ask: `Which charger is right for ${my}?` }];
    case 'home': return [{ label: phone ? `Battery for my ${phone}` : 'Battery for my phone', ask: `Find a battery for ${my}` }, delivery];
  }
}
