import { runAssistant, shopperNote, type AssistantEvent, type ChatTurn } from './assistant';
import { namedProducts } from './goldieProducts';
import { CLARIFY_PHONE, SOFT_LIMIT_TEXT, answerDeterministically, classify, isClarificationReply, type Classification, type DeterministicAnswer, type Intent } from './assistantRouter';
import { admit, release, settle, type AdmitOutput } from './assistantAdmission';
import { interestTopic, recordInterest, shopperContext, type ShopperIdentity } from './assistantConversation';
import { ORDER_REF, type CareContext } from './goldieCare';
import { acknowledge, checkBack, clarifyFirst, detectLanguage, readMood, type MoodRead } from './goldieEmpathy';
import { TEAM_HANDOVER_PATH } from './goldieLinks';
import { recall, remember } from './goldieAnswerMemory';

/**
 * One Goldie turn, whatever the channel (website chat, WhatsApp, the next
 * messaging app): read the customer (intent AND mood), decide the route under
 * the spend policy, answer (fixed answer from shop data, or the model with
 * tools), and say what happened, so the caller can stream it, send it, and
 * file it.
 *
 * Listening comes first. A thin message gets one clarifying question instead
 * of a guess; every fixed answer opens with a line that names the customer's
 * situation in a tone that matches their mood, and an upset customer always
 * gets the way to a person.
 */
export interface TurnInput {
  channel: 'web' | 'whatsapp' | 'messenger' | 'instagram';
  turns: ChatTurn[];
  requestId: string | null;
  principalHash: string;
  addressHash: string | null;
  who: ShopperIdentity;
  care: CareContext;
  page?: string | null;
  apiKey: string;
  signal?: AbortSignal;
}

export interface TurnMeta { intent: Intent | 'CLARIFY'; mood: MoodRead; route: 'deterministic' | 'ai' | 'fallback' | 'cache'; tier: string; cacheId?: string | null; nextAction?: string | null }
export type TurnEvent = AssistantEvent | { type: 'meta'; meta: TurnMeta };

export type PreparedTurn =
  | { kind: 'refused'; status: number; code: string; message: string; retryAfter?: string }
  | { kind: 'run'; meta: TurnMeta; run: () => AsyncGenerator<TurnEvent> };

const MAX_CONCURRENT = 8;
let inFlight = 0;
/** Test seam. */
export function resetTurnState(): void { inFlight = 0; }

const ZERO = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

const fallbackAnswer = async (classified: Classification, conversational = false): Promise<DeterministicAnswer> => {
  // Paid AI is not available for this turn: a product lookup still runs, and the honest sentence leads. Not for a
  // reply inside a conversation ("the second one", "is it original?"): searching those words finds nothing useful.
  const base = !conversational && (classified.intent === 'PRODUCT' || classified.intent === 'UNKNOWN')
    ? await answerDeterministically({ ...classified, intent: 'PRODUCT', deterministic: true }).catch(() => null)
    : null;
  const products = base?.products ?? [];
  return { intent: classified.intent, text: products.length ? `${SOFT_LIMIT_TEXT} Here is what matched in the catalogue:` : SOFT_LIMIT_TEXT, products, links: base?.links ?? [] };
};

/** A number given after Goldie asked which number the team should call is the same callback request. */
export function isCallbackFollowUp(turns: readonly ChatTurn[]): boolean {
  const last = turns[turns.length - 1]?.content ?? '';
  const prev = turns.length >= 2 ? turns[turns.length - 2] : undefined;
  return !!prev && prev.role === 'assistant' && /which number should the team call/i.test(prev.content) && /(?:\+?256|0)\s?7\d{2}[\s-]?\d{3}[\s-]?\d{3}/.test(last) && last.length <= 80;
}

/** A short answer to the battery finder's "Which of these is your phone?" that is not some other clear request. */
export function isBatteryPhoneAnswer(turns: readonly ChatTurn[], classified: Classification): boolean {
  const prev = turns.length >= 2 ? turns[turns.length - 2] : undefined;
  const last = (turns[turns.length - 1]?.content ?? '').trim();
  if (!prev || prev.role !== 'assistant' || !prev.content.includes(CLARIFY_PHONE)) return false;
  if (!last || last.length > 60 || /\?/.test(last)) return false;
  return ['UNKNOWN', 'PRODUCT', 'BATTERY', 'GREETING'].includes(classified.intent) && !/^(no|none|neither|not sure|i don'?t know|ok|okay|thanks?|thank you)\b/i.test(last);
}

/** A reply to Goldie's own "which order / what phone" question is the same order request, answered from the order system. */
export function isOrderFollowUp(turns: readonly ChatTurn[]): boolean {
  const last = turns[turns.length - 1]?.content ?? '';
  const prev = turns.length >= 2 ? turns[turns.length - 2] : undefined;
  if (!prev || prev.role !== 'assistant') return false;
  const asked = /phone number or email (you )?used at checkout|order reference/i.test(prev.content);
  const gave = ORDER_REF.test(last) || /[\w.+-]+@[\w-]+\.[\w.-]+/.test(last) || /(?:\+?256|0)\s?7\d{2}[\s-]?\d{3}[\s-]?\d{3}/.test(last);
  return asked && gave && last.length <= 120;
}

/**
 * A reply inside a conversation is read WITH the conversation. A router that sees only the last message forgets
 * what was said ten seconds ago: after Goldie lists three power banks, "how much is the second one?" became a
 * search for "second one", "is it original?" a fake-product check, "yes" a greeting. When the customer is answering
 * Goldie's question, or points back at what was said (it, that one, the second, the cheaper, and for Samsung?),
 * the model answers with the history. New, self-contained requests (an order reference, delivery to an area, the
 * shop hours) and a plain thank-you keep their fixed answers.
 */
export function isConversationalReply(turns: readonly ChatTurn[], classified: Classification): boolean {
  const prev = turns.length >= 2 ? turns[turns.length - 2] : undefined;
  if (!prev || prev.role !== 'assistant') return false;
  if (!['PRODUCT', 'UNKNOWN', 'GREETING', 'POLICY'].includes(classified.intent)) return false;
  const last = (turns[turns.length - 1]?.content ?? '').trim().toLowerCase();
  if (!last || last.length > 160) return false;
  const askedQuestion = /\?\s*$/.test(prev.content.trim());
  // A thank-you, or a bare "ok" after an answer that asked nothing, is the customer closing: the short fixed reply is right.
  if (classified.intent === 'GREETING' && (/\b(thanks?|thank you|thx|webale|weebale|mwebale|asante)\b/.test(last) || !askedQuestion)) return false;
  // A fault or fake report names its own subject ("my charger is fake"); only "is it / is this one original?" points back.
  if (classified.intent === 'POLICY' && !/\b(it|this|that|this one|that one|they|them|these|those)\b/.test(last)) return false;
  const pointsBack = /\b(it|its|this|that|these|those|one|ones|them|they|first|second|third|last|1st|2nd|3rd|cheaper|cheapest|other|same|both|either|yes|yeah|yep|no|nope|sure|which|instead|another|more|else|also|too|what about|how about)\b/.test(last) || /^(and|but|so|ok|okay)\b/.test(last);
  return askedQuestion || pointsBack;
}

/** A first name worth using from a WhatsApp profile name ("Rob", "Sarah N" → Sarah); null for "~ 🌸", "GoldPlus Test", digits. */
export function profileFirstName(name: string | null | undefined): string | null {
  const first = (name ?? '').normalize('NFKC').trim().split(/\s+/)[0] ?? '';
  const clean = first.replace(/[^\p{L}'-]/gu, '');
  if (clean.length < 2 || clean.length > 20 || /^(test|goldplus|shop|admin|user|customer|mr|mrs|ms|dr|sir|madam)$/i.test(clean)) return null;
  return clean[0]!.toUpperCase() + clean.slice(1).toLowerCase();
}

export async function prepareTurn(input: TurnInput): Promise<PreparedTurn> {
  const last = input.turns[input.turns.length - 1]!.content;
  const mood = readMood(last);
  input = { ...input, care: { ...input.care, channel: input.channel, mood: mood.mood, lastCustomerMessage: last } };
  let classified = classify(last);
  if (isOrderFollowUp(input.turns)) classified = { intent: 'ORDER', deterministic: true, query: '' };
  // The answer to the battery finder's own "Which of these is your phone?" ("Spark 10 Pro") goes back to the finder,
  // which gives the exact fit, instead of to the model.
  else if (isBatteryPhoneAnswer(input.turns, classified)) classified = { intent: 'BATTERY', deterministic: true, query: last.trim().slice(0, 60) };
  else if (isCallbackFollowUp(input.turns)) classified = { intent: 'CALLBACK', deterministic: true, query: '' };
  // Luganda or Swahili: the model answers in their language from the same facts (fixed answers are English).
  // Order, points and callback flows stay fixed (they need exact proof handling); a refused model falls back to them.
  const lang = detectLanguage(last);
  const languageUpgrade = lang !== 'en' && classified.deterministic && ['GREETING', 'STORE', 'DELIVERY', 'PAYMENT', 'POLICY', 'BULK', 'PRODUCT', 'BATTERY'].includes(classified.intent);
  if (languageUpgrade) classified = { ...classified, deterministic: false };
  // Inside a conversation, a reply is answered with the conversation (see isConversationalReply).
  const conversational = isConversationalReply(input.turns, classified);
  if (conversational) classified = { ...classified, intent: classified.intent === 'GREETING' ? 'UNKNOWN' : classified.intent, deterministic: false };
  // On WhatsApp, Messenger and Instagram a product question is a personal shopper's job: the model recommends the one
  // that fits and asks the one question that matters (which phone?), instead of a fixed list. The fixed list remains
  // the fallback when the spend policy says no.
  const shopperUpgrade = input.channel !== 'web' && classified.intent === 'PRODUCT' && classified.deterministic;
  if (shopperUpgrade) classified = { ...classified, deterministic: false };
  const clarify = !languageUpgrade && !conversational && (classified.intent === 'UNKNOWN' || classified.intent === 'PRODUCT') ? clarifyFirst(last, classified.intent) : null;
  // Answer memory first: a general question asked before is answered from memory (facts re-checked live), at no model cost.
  const singleTurn = input.turns.length === 1;
  const remembered = !classified.deterministic && !clarify && singleTurn ? await recall(last).catch(() => null) : null;
  const wantsAi = !classified.deterministic && !clarify && !remembered;

  // Customer DNA: what this shopper is after (never an order, payment or complaint; never a phone number or email).
  if (['PRODUCT', 'BATTERY', 'BULK'].includes(classified.intent) && !clarify) {
    const topic = classified.intent === 'BATTERY' && classified.query ? interestTopic(`${classified.query} battery`, '') : interestTopic(classified.query, last);
    if (topic.length >= 3) recordInterest(input.who, { intent: classified.intent, topic, phoneModel: classified.intent === 'BATTERY' ? classified.query || null : null, page: input.page ?? null });
  }

  const continuation = isClarificationReply(input.turns, classified);
  const admission: AdmitOutput = (await admit({ principalHash: input.principalHash, addressHash: input.addressHash, wantsAi, conversationId: input.requestId, requestId: input.requestId, continuation })) ?? {
    // The admission authority could not be reached: fail closed for money, open for deterministic help.
    decision: wantsAi ? 'GLOBAL_BUDGET_FALLBACK' : 'ALLOW_DETERMINISTIC', tier: 'welcome', reason: 'admission unreachable', reservationId: null,
    model: '', effort: 'low', maxOutputTokens: 0, maxToolRounds: 0, degraded: true,
  };
  if (admission.decision === 'DUPLICATE') return { kind: 'refused', status: 409, code: 'DUPLICATE', message: 'That question is already being answered.' };
  if (admission.decision === 'DISABLED') return { kind: 'refused', status: 503, code: 'DISABLED', message: 'The assistant is switched off for now.' };
  if (admission.decision === 'DENY_EXPENSIVE') return { kind: 'refused', status: 429, code: 'RATE_LIMITED', message: 'Please wait a moment before asking more.', retryAfter: String(admission.retryAfterSeconds ?? 60) };

  const route: TurnMeta['route'] = remembered ? 'cache' : admission.decision === 'ALLOW_AI' ? 'ai' : wantsAi ? 'fallback' : 'deterministic';
  if (route === 'ai' && inFlight >= MAX_CONCURRENT) {
    if (admission.reservationId) void release({ reservationId: admission.reservationId, reason: 'replica concurrency cap' });
    return { kind: 'refused', status: 503, code: 'BUSY', message: 'Goldie is busy right now. Please try again in a minute.', retryAfter: '30' };
  }
  const meta: TurnMeta = { intent: clarify ? 'CLARIFY' : classified.intent, mood, route, tier: admission.tier, cacheId: remembered?.id ?? null };
  const seed = input.requestId ?? last;
  const team = { label: 'Email the team', url: `${input.care.site}${TEAM_HANDOVER_PATH}` };

  /** A fixed answer, heard first: acknowledgement, the answer, and a check-back when it helps. */
  const heard = (a: DeterministicAnswer): DeterministicAnswer => {
    const ack = acknowledge(a.intent, mood, seed);
    const back = checkBack(a.intent, mood, seed);
    const text = [ack, a.text, back && !/\?\s*$/.test(a.text) ? back : ''].filter(Boolean).join(' ');
    const needsPerson = mood.mood === 'upset' && ['ORDER', 'PAYMENT', 'POLICY', 'DELIVERY'].includes(a.intent);
    const links = needsPerson && !a.links.some((l) => l.url === team.url) && input.channel === 'web' ? [...a.links, team] : a.links;
    return { ...a, text, links };
  };

  async function* run(): AsyncGenerator<TurnEvent> {
    yield { type: 'meta', meta };
    const emit = function* (a: DeterministicAnswer): Generator<TurnEvent> {
      yield { type: 'text', text: a.text };
      if (a.products.length) yield { type: 'products', items: a.products };
      if (a.links.length) yield { type: 'links', items: a.links };
      yield { type: 'done', usage: { ...ZERO }, providerRequestId: null, outcome: 'ANSWERED' };
    };
    if (clarify) { yield* emit({ intent: classified.intent, text: [acknowledge('UNKNOWN', mood, seed), clarify].filter(Boolean).join(' '), products: [], links: [] }); return; }
    if (route === 'deterministic') {
      const a = heard(await answerDeterministically(classified, { care: input.care, turns: input.turns }));
      // A hello on WhatsApp greets the customer by name (free, fixed): "Hello Rob, welcome to GoldPlus…".
      const first = input.channel !== 'web' && classified.intent === 'GREETING' && !/^(ok|okay|cool|sure|thanks?|thank|thx|webale|weebale|mwebale|asante)/.test(classified.query) ? profileFirstName(input.care.customerName) : null;
      yield* emit(first ? { ...a, text: `Hello ${first}, welcome to GoldPlus. What are you looking for today? A charger, a power bank, earphones, or a battery for your phone, tell me and I'll find the right one.` } : a);
      return;
    }
    if (route === 'cache' && remembered) { yield* emit(heard({ intent: classified.intent, text: remembered.text, products: namedProducts(remembered.text, remembered.products, 3), links: [] })); return; }
    if (route === 'fallback') {
      // A language upgrade the model could not take: the fixed answer (in English) beats an apology.
      if (languageUpgrade || shopperUpgrade) { yield* emit(heard(await answerDeterministically({ ...classified, deterministic: true }, { care: input.care, turns: input.turns }))); return; }
      yield* emit(heard(await fallbackAnswer(classified, conversational)));
      return;
    }

    inFlight += 1;
    const reservationId = admission.reservationId!;
    let settled = false;
    let usageSoFar: (() => import('./assistant').Usage) | null = null;
    try {
      const ctx = await shopperContext(input.who);
      meta.nextAction = ctx?.nextBestAction ?? null;
      const moodLine = (mood.mood === 'neutral' ? '' : ` This message reads as ${mood.mood}${mood.urgent ? ' and urgent' : ''}; acknowledge that first.`)
        + (lang === 'lg' ? ' The customer is writing in Luganda: answer in Luganda.' : lang === 'sw' ? ' The customer is writing in Swahili: answer in Swahili.' : '');
      const channelLine = input.channel === 'whatsapp' ? ' Channel: WhatsApp (plain text, no cards; keep it short).'
        : input.channel === 'messenger' || input.channel === 'instagram' ? ` Channel: ${input.channel === 'messenger' ? 'Facebook Messenger' : 'Instagram'} (plain text, no cards; keep it short). There is no verified phone here: for an order or points, ask for the order number and the phone used, as on the website.` : '';
      // The customer's WhatsApp profile name, when the shop's records have none: a shop assistant uses the name.
      const profileName = !ctx?.firstName && input.channel === 'whatsapp' ? profileFirstName(input.care.customerName) : null;
      const nameLine = profileName ? ` WhatsApp profile name: ${profileName} (use it lightly, the way a shopkeeper would).` : '';
      const note = (shopperNote(ctx) + nameLine + channelLine + moodLine).trim();
      // Cost: the model sees the last eight turns, starting with the customer (older turns rarely change the answer).
      let modelTurns = input.turns.slice(-8);
      while (modelTurns.length && modelTurns[0]!.role !== 'user') modelTurns = modelTurns.slice(1);
      // What the answer showed and used, to decide whether it can be remembered for the next customer.
      let answerText = ''; let shown: import('./assistantRouter').ProductCard[] = []; // Personal = the model was told anything about this shopper beyond the time of day (it is asked to use it:
      // "welcome back", "still after that power bank?"), so the answer is never replayed to another customer.
      let personal = input.channel !== 'web' || mood.mood !== 'neutral' || (!!ctx && (!!ctx.firstName || ctx.visits >= 2 || ctx.hasOrdered
        || ctx.topCategories.length > 0 || ctx.recentlyViewed.length > 0 || ctx.pastTopics.length > 0 || !!ctx.nextBestAction));
      for await (const ev of runAssistant(modelTurns, { apiKey: input.apiKey, model: admission.model, effort: admission.effort, maxOutputTokens: admission.maxOutputTokens, maxToolRounds: admission.maxToolRounds, signal: input.signal, shopperNote: note, care: input.care, onUsageProbe: (probe) => { usageSoFar = probe; } })) {
        if (ev.type === 'text') answerText += ev.text;
        // Products are held until the answer is written, then only the ones it names are shown (the search's other
        // results would sit under a recommendation of a different product).
        else if (ev.type === 'products') { shown = [...shown, ...ev.items]; continue; }
        else if (ev.type === 'tool' && !['search_products', 'get_product', 'list_categories', 'find_battery', 'store_info'].includes(ev.name)) personal = true;
        if (ev.type === 'done') {
          settled = true;
          const picked = namedProducts(answerText, shown, 3);
          if (picked.length) yield { type: 'products', items: picked };
          if (singleTurn && !personal && ev.outcome === 'ANSWERED' && answerText) remember(last, answerText, classified.intent, picked);
          await settle({ reservationId, model: admission.model, providerRequestId: ev.providerRequestId, outcome: ev.outcome, usage: ev.usage });
        } else if (ev.type === 'error') {
          settled = true;
          // Not billed (refused before any output): give the money back. Billed or unknown: settle what is known; a
          // partial stream with unknown output stays reserved and becomes UNKNOWN, never zero.
          if (!ev.billed) await release({ reservationId, reason: ev.code });
          else if (ev.usage && ev.usage.outputTokens > 0) await settle({ reservationId, model: admission.model, providerRequestId: null, outcome: 'STREAM_FAILED', usage: ev.usage });
        }
        yield ev;
      }
    } finally {
      inFlight = Math.max(0, inFlight - 1);
      // The shopper left mid-answer (the stream's reader stopped, so this finally is where we are). Keeping the whole
      // reservation (every round at full size) counted 5-10x what a turn costs: ~430 abandoned answers a month would
      // switch the paid layer off (2026-10-22). Settled instead on what the provider reported, plus one round's full
      // output (the round in flight never reports its output): never under-counted. Nothing reported yet: the
      // reservation stays, as before.
      if (!settled) {
        const u = usageSoFar ? (usageSoFar as () => import('./assistant').Usage)() : null;
        if (u && u.inputTokens > 0) {
          await settle({ reservationId, model: admission.model, providerRequestId: null, outcome: 'ABORTED', usage: { ...u, outputTokens: u.outputTokens + admission.maxOutputTokens } }).catch(() => undefined);
        }
      }
    }
  }
  return { kind: 'run', meta, run };
}
