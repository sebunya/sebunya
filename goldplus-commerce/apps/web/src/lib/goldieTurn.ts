import { runAssistant, shopperNote, type AssistantEvent, type ChatTurn } from './assistant';
import { SOFT_LIMIT_TEXT, answerDeterministically, classify, isClarificationReply, type Classification, type DeterministicAnswer, type Intent } from './assistantRouter';
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

const fallbackAnswer = async (classified: Classification): Promise<DeterministicAnswer> => {
  // Paid AI is not available for this turn: a product lookup still runs, and the honest sentence leads.
  const base = classified.intent === 'PRODUCT' || classified.intent === 'UNKNOWN'
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

/** A reply to Goldie's own "which order / what phone" question is the same order request, answered from the order system. */
export function isOrderFollowUp(turns: readonly ChatTurn[]): boolean {
  const last = turns[turns.length - 1]?.content ?? '';
  const prev = turns.length >= 2 ? turns[turns.length - 2] : undefined;
  if (!prev || prev.role !== 'assistant') return false;
  const asked = /phone number or email (you )?used at checkout|order reference/i.test(prev.content);
  const gave = ORDER_REF.test(last) || /[\w.+-]+@[\w-]+\.[\w.-]+/.test(last) || /(?:\+?256|0)\s?7\d{2}[\s-]?\d{3}[\s-]?\d{3}/.test(last);
  return asked && gave && last.length <= 120;
}

export async function prepareTurn(input: TurnInput): Promise<PreparedTurn> {
  const last = input.turns[input.turns.length - 1]!.content;
  const mood = readMood(last);
  input = { ...input, care: { ...input.care, channel: input.channel, mood: mood.mood } };
  let classified = classify(last);
  if (isOrderFollowUp(input.turns)) classified = { intent: 'ORDER', deterministic: true, query: '' };
  else if (isCallbackFollowUp(input.turns)) classified = { intent: 'CALLBACK', deterministic: true, query: '' };
  // Luganda or Swahili: the model answers in their language from the same facts (fixed answers are English).
  // Order, points and callback flows stay fixed (they need exact proof handling); a refused model falls back to them.
  const lang = detectLanguage(last);
  const languageUpgrade = lang !== 'en' && classified.deterministic && ['GREETING', 'STORE', 'DELIVERY', 'PAYMENT', 'POLICY', 'BULK', 'PRODUCT', 'BATTERY'].includes(classified.intent);
  if (languageUpgrade) classified = { ...classified, deterministic: false };
  const clarify = !languageUpgrade && (classified.intent === 'UNKNOWN' || classified.intent === 'PRODUCT') ? clarifyFirst(last, classified.intent) : null;
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
    if (route === 'deterministic') { yield* emit(heard(await answerDeterministically(classified, { care: input.care, turns: input.turns }))); return; }
    if (route === 'cache' && remembered) { yield* emit(heard({ intent: classified.intent, text: remembered.text, products: remembered.products, links: [] })); return; }
    if (route === 'fallback') {
      // A language upgrade the model could not take: the fixed answer (in English) beats an apology.
      if (languageUpgrade) { yield* emit(heard(await answerDeterministically({ ...classified, deterministic: true }, { care: input.care, turns: input.turns }))); return; }
      yield* emit(heard(await fallbackAnswer(classified)));
      return;
    }

    inFlight += 1;
    const reservationId = admission.reservationId!;
    let settled = false;
    try {
      const ctx = await shopperContext(input.who);
      meta.nextAction = ctx?.nextBestAction ?? null;
      const moodLine = (mood.mood === 'neutral' ? '' : ` This message reads as ${mood.mood}${mood.urgent ? ' and urgent' : ''}; acknowledge that first.`)
        + (lang === 'lg' ? ' The customer is writing in Luganda: answer in Luganda.' : lang === 'sw' ? ' The customer is writing in Swahili: answer in Swahili.' : '');
      const channelLine = input.channel === 'whatsapp' ? ' Channel: WhatsApp (plain text, no cards; keep it short).'
        : input.channel === 'messenger' || input.channel === 'instagram' ? ` Channel: ${input.channel === 'messenger' ? 'Facebook Messenger' : 'Instagram'} (plain text, no cards; keep it short). There is no verified phone here: for an order or points, ask for the order number and the phone used, as on the website.` : '';
      const note = (shopperNote(ctx) + channelLine + moodLine).trim();
      // Cost: the model sees the last eight turns, starting with the customer (older turns rarely change the answer).
      let modelTurns = input.turns.slice(-8);
      while (modelTurns.length && modelTurns[0]!.role !== 'user') modelTurns = modelTurns.slice(1);
      // What the answer showed and used, to decide whether it can be remembered for the next customer.
      let answerText = ''; let shown: import('./assistantRouter').ProductCard[] = []; let personal = !!ctx?.firstName || input.channel !== 'web' || mood.mood !== 'neutral';
      for await (const ev of runAssistant(modelTurns, { apiKey: input.apiKey, model: admission.model, effort: admission.effort, maxOutputTokens: admission.maxOutputTokens, maxToolRounds: admission.maxToolRounds, signal: input.signal, shopperNote: note, care: input.care })) {
        if (ev.type === 'text') answerText += ev.text;
        else if (ev.type === 'products') shown = [...shown, ...ev.items];
        else if (ev.type === 'tool' && !['search_products', 'get_product', 'list_categories', 'find_battery', 'store_info'].includes(ev.name)) personal = true;
        if (ev.type === 'done') {
          settled = true;
          if (singleTurn && !personal && ev.outcome === 'ANSWERED' && answerText) remember(last, answerText, classified.intent, shown);
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
      if (!settled) { /* caller aborted mid-turn: the reservation ages into UNKNOWN and keeps counting */ }
    } finally {
      inFlight = Math.max(0, inFlight - 1);
    }
  }
  return { kind: 'run', meta, run };
}
