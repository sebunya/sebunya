/**
 * Listening before answering: how the customer feels, and a first line that
 * shows they were heard. Pure and deterministic (no model), so it runs on every
 * turn, costs nothing, and is the same on the website and on WhatsApp.
 *
 * The pattern is the one the best care teams use (O2's "acknowledge, own,
 * resolve, check" is the owner's reference): say back what the customer needs
 * in a few words, match how they feel, then the answer, then check it landed.
 * Never a stock "I understand your frustration": the line names THEIR thing.
 */

export type Mood = 'upset' | 'worried' | 'confused' | 'happy' | 'neutral';
export interface MoodRead { mood: Mood; urgent: boolean }

const UPSET = /\b(angry|annoyed|furious|frustrat\w*|disappoint\w*|terrible|horrible|useless|rubbish|worst|scam|cheat\w*|conned|lied|liars?|ridiculous|unacceptable|nonsense|still (not|no|waiting|nothing)|no one|nobody (has|is|called|answered)|never (came|arrived|got)|waste of|fed up|tired of|again\?|what kind of|refund my|i want my money)\b/i;
const WORRIED = /\b(urgent\w*|asap|emergency|today|right now|immediately|quickly|please help|help me|worried|stuck|lost|deducted|money (left|went|was taken|gone)|charged (twice|two times)|double charged|not received|hasn'?t (come|arrived)|where is my|is it safe)\b/i;
const CONFUSED = /\b(confus\w*|don'?t understand|not sure|which one|what does .* mean|how do i|how does|what is the difference|i don'?t know|explain)\b/i;
const HAPPY = /\b(thank(s| you)|great|perfect|awesome|amazing|love (it|this|you)|excellent|good job|well done|webale|nice one|it works|received it|got it)\b/i;

/** How this message reads. Shouting (mostly capitals) and repeated !/? count as upset. */
export function readMood(raw: string): MoodRead {
  const text = raw.trim();
  const letters = text.replace(/[^A-Za-z]/g, '');
  const shouting = letters.length >= 12 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7;
  const urgent = WORRIED.test(text) || /!{2,}/.test(text);
  if (UPSET.test(text) || shouting || /[!?]{3,}/.test(text)) return { mood: 'upset', urgent: true };
  if (WORRIED.test(text)) return { mood: 'worried', urgent };
  if (CONFUSED.test(text)) return { mood: 'confused', urgent };
  if (HAPPY.test(text)) return { mood: 'happy', urgent: false };
  return { mood: 'neutral', urgent };
}

/** Stable variety: the same conversation never repeats a stock line, and a test can pin the output. */
const pick = <T,>(options: readonly T[], seed: string): T => {
  let h = 0; for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return options[h % options.length]!;
};

/** What the customer is after, in their terms, for the intents the router answers itself. */
const NEED: Record<string, string> = {
  ORDER: 'your order', PAYMENT: 'your payment', POLICY: 'this', DELIVERY: 'getting it to you', BATTERY: 'the right battery',
  PRODUCT: 'finding the right one', BULK: 'your bulk order', STORE: 'finding us', LOYALTY: 'your points', CALLBACK: '', IDENTITY: '', GREETING: '', UNKNOWN: '',
};

/**
 * The first line of a fixed answer. Empty when the answer itself already does the job (a greeting, a plain
 * product lookup from a calm customer): acknowledgement should never become padding.
 */
export function acknowledge(intent: string, read: MoodRead, seed: string): string {
  const need = NEED[intent] ?? '';
  if (read.mood === 'upset') {
    if (intent === 'ORDER' || intent === 'PAYMENT' || intent === 'DELIVERY') return pick([
      `I'm sorry, that's not the experience we want for you. Let's sort out ${need} now.`,
      `I hear you, and I'm sorry about the wait. Let's get ${need} sorted.`,
      `That's frustrating, and I'm sorry. I'll help you with ${need} right away.`,
    ], seed);
    // The warranty answer already opens with thanks and an apology; a second one would be padding.
    if (intent === 'POLICY') return '';
    return pick(["I'm sorry about that. Let's get it right.", "I hear you. Let me help properly."], seed);
  }
  if (read.mood === 'worried') {
    if (intent === 'PAYMENT') return pick(['Your money matters to us, so let me be clear on this.', "Don't worry, let's check this properly."], seed);
    if (intent === 'ORDER' || intent === 'DELIVERY') return pick([`Let's check on ${need} for you now.`, `I understand you need ${need} sorted soon. Here's where we stand.`], seed);
    return need ? `Let's sort out ${need} quickly.` : "Let's sort this out quickly.";
  }
  if (read.mood === 'confused') return pick(["Good question, let me make it simple.", "Let me explain it plainly."], seed);
  if (read.mood === 'happy' && intent === 'GREETING') return '';
  if (intent === 'ORDER') return pick(['Let me check on your order.', "Sure, let's look at your order."], seed);
  if (intent === 'LOYALTY') return "Let's look at your points.";
  return '';
}

/** A short closing check, so the customer knows we are still listening (not after every message: only when it helps). */
export function checkBack(intent: string, read: MoodRead, seed: string): string {
  if (read.mood === 'upset' || read.mood === 'worried') return pick(['Does that sort it, or shall I pass this to the team?', 'Is there anything else about this I can check for you?'], seed);
  if (intent === 'ORDER' || intent === 'PAYMENT' || intent === 'POLICY') return 'Anything else on this I can help with?';
  return '';
}

/**
 * A request too thin to answer well ("charger", "I need help", "price?"): ask one question first rather than
 * guess. Returns that question, or null when the message is clear enough to act on.
 */
export function clarifyFirst(raw: string, intent: string): string | null {
  const t = raw.trim().toLowerCase().replace(/[?.!]+$/g, '');
  if (/^(help|i need help|please help|hello i need help|i have a problem|problem|issue|i have an issue)$/.test(t)) return "Of course. Tell me a little about what you need, a product, an order, a delivery or a problem with something you bought, and I'll take it from there.";
  if (intent === 'PRODUCT' && /^(a |an |the )?(charger|cable|power ?bank|earphones?|earbuds|headphones?|battery|speaker|adapter)s?$/.test(t)) {
    const thing = t.replace(/^(a |an |the )/, '');
    return /battery/.test(thing) ? 'Which phone is it for? The exact model, for example Tecno Spark 10, or the code on the old battery.' : `Happy to help with a ${thing}. Which phone or device is it for?`;
  }
  if (/^(price|how much|cost)$/.test(t)) return 'Which product would you like the price for?';
  return null;
}

/**
 * The customer's language, from words they would not use in English. Luganda and Swahili customers get their
 * answer in their own language (the model writes it, from the same facts and tools), instead of a fixed English
 * line. Two marker words are needed, so a single "webale" or "asante" in an English message stays English.
 */
const LUGANDA = /\b(oli otya|webale|nsaba|mwattu|ssebo|nnyabo|njagala|nyagala|mpa|bbeeyi|beeyi|ssente|simu yange|nedda|simanyi|nina|tewali|wano|kati|ddi|kiki|ani|nti|okugula|okutuusa|okuleeta|nnyo|ebyuma|kyetaagisa)\b/gi;
const SWAHILI = /\b(habari|tafadhali|asante|nataka|ninahitaji|bei|simu yangu|je|gani|ngapi|kwa|sana|nini|wapi|lini|ndiyo|hapana|leo|kesho|naomba|unaweza|nipe|kununua|kuleta)\b/gi;
export type Lang = 'en' | 'lg' | 'sw';
export function detectLanguage(raw: string): Lang {
  const t = raw.toLowerCase();
  const lg = new Set((t.match(LUGANDA) ?? []).map((w) => w.toLowerCase())).size;
  const sw = new Set((t.match(SWAHILI) ?? []).map((w) => w.toLowerCase())).size;
  if (lg >= 2 && lg >= sw) return 'lg';
  if (sw >= 2) return 'sw';
  return 'en';
}
