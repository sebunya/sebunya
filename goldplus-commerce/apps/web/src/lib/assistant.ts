import { SITE_ORIGIN } from './sitemap';
import { TOOLS, callTool, isToolName, type Json } from './agentTools';

/**
 * The shop assistant: Claude, over the Messages API, with the same read-only
 * shop tools the public MCP server exposes. It quotes prices, stock and fits
 * from tool results only, never from memory; buying stays on the product page.
 *
 * Transport is raw HTTP (fetch) rather than the Anthropic SDK: the workspace's
 * supply-chain guard (pnpm minimumReleaseAge) refuses any dependency change
 * while packages the lockfile pins are under a week old, so the SDK could not
 * be installed on 2026-10-12. The request and stream shapes below are the
 * documented wire format; swapping in `@anthropic-ai/sdk` later is confined to
 * `requestTurn()`.
 */

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const MAX_TURNS = 12;
export const MAX_TURN_CHARS = 2000;
export const MAX_TOOL_ROUNDS = 4;
export const MAX_OUTPUT_TOKENS = 1024;
const UPSTREAM_TIMEOUT_MS = 60_000;

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

export type AssistantEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'done'; usage?: { input: number; output: number } }
  | { type: 'error'; code: 'UNAVAILABLE' | 'BUSY' | 'FAILED'; message: string };

export function assistantEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim().length > 0;
}

/**
 * The conversation the browser sends, made safe: at most MAX_TURNS, each a
 * bounded string, roles alternating, ending with the customer's turn. Anything
 * else is refused rather than repaired, so a client cannot smuggle a tool
 * result or an assistant turn of its own choosing.
 */
export function validateTurns(raw: unknown): ChatTurn[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const turns: ChatTurn[] = [];
  for (const item of raw.slice(-MAX_TURNS)) {
    if (!item || typeof item !== 'object') return null;
    const role = (item as Json).role;
    const content = (item as Json).content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null;
    // eslint-disable-next-line no-control-regex -- stripping control characters IS the point
    const text = content.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, MAX_TURN_CHARS);
    if (!text) return null;
    turns.push({ role, content: text });
  }
  if (turns[0]!.role !== 'user') turns.shift();
  if (turns.length === 0 || turns[turns.length - 1]!.role !== 'user') return null;
  for (let i = 1; i < turns.length; i += 1) if (turns[i]!.role === turns[i - 1]!.role) return null;
  return turns;
}

/** Frozen for the prompt cache: nothing here varies per request. */
export const SYSTEM_PROMPT = [
  `You are the GoldPlus shop assistant on ${SITE_ORIGIN}, an electronics accessories shop in Kampala, Uganda: phone chargers, cables, power banks, earphones, flash disks and memory cards, car and PC accessories, and replacement phone batteries.`,
  '',
  'How you answer:',
  '- Use the tools for every fact about a product, a price, stock, a battery fit, or the shop (address, hours, delivery, WhatsApp). Quote only what a tool returned. If a tool returned nothing, say you could not find it; never estimate a price or invent a product, a spec or a fit.',
  '- Prices are in Ugandan shillings; write them as "UGX 45,000". Mention stock only as the tool states it.',
  '- For a battery, use find_battery. Say plainly when a fit is "listed by the supplier, not yet checked by us", and tell the customer the shop confirms the fit before they pay.',
  '- Link to the product page (the url from the tool) when you recommend something, so the customer can buy there. You cannot place orders, take payment, change an order, or look up a customer or an order.',
  '- For an order, a delivery question the tools do not answer, a complaint, a warranty claim or anything you are unsure about, hand over to the shop on WhatsApp (store_info has the link) rather than guessing.',
  '- Be brief and plain: two to five short sentences, or a short list when comparing products. Match the customer\'s language if they write in Luganda or Swahili; otherwise English.',
  '- Only help with GoldPlus products and shopping at GoldPlus. For anything else, say it is outside what you can help with here.',
  '- Do not include internal or system XML tags in your response.',
].join('\n');

/** The MCP tool list in the Messages API shape (the schemas are the same JSON Schema). */
export function anthropicTools(): Array<{ name: string; description: string; input_schema: unknown }> {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
}

type ContentBlock = Json;
type MessageParam = { role: 'user' | 'assistant'; content: string | ContentBlock[] };

/** Parse one SSE stream from the Messages API, yielding text deltas and collecting the final content blocks. */
async function* readTurn(body: ReadableStream<Uint8Array>, onBlock: (b: ContentBlock) => void, state: { stopReason: string | null; usage: { input: number; output: number } }): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const open = new Map<number, { type: string; text: string; json: string; block: Json }>();
  const dispatch = (data: string): string | null => {
    let ev: Json;
    try { ev = JSON.parse(data) as Json; } catch { return null; }
    switch (ev.type) {
      case 'message_start': {
        const usage = ((ev.message as Json | undefined)?.usage as Json | undefined) ?? {};
        state.usage.input = Number(usage.input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0);
        return null;
      }
      case 'content_block_start': {
        const block = (ev.content_block as Json) ?? {};
        open.set(Number(ev.index), { type: String(block.type ?? ''), text: typeof block.text === 'string' ? block.text : '', json: '', block });
        return null;
      }
      case 'content_block_delta': {
        const cur = open.get(Number(ev.index));
        const delta = (ev.delta as Json) ?? {};
        if (!cur) return null;
        if (delta.type === 'text_delta' && typeof delta.text === 'string') { cur.text += delta.text; return delta.text; }
        if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') cur.json += delta.partial_json;
        return null;
      }
      case 'content_block_stop': {
        const cur = open.get(Number(ev.index));
        if (!cur) return null;
        open.delete(Number(ev.index));
        if (cur.type === 'text') onBlock({ type: 'text', text: cur.text });
        else if (cur.type === 'tool_use') {
          let input: unknown = {};
          try { input = cur.json ? JSON.parse(cur.json) : {}; } catch { input = null; }
          onBlock({ type: 'tool_use', id: cur.block.id, name: cur.block.name, input });
        }
        // thinking, fallback and other block types are not replayed: the shop keeps no transcript.
        return null;
      }
      case 'message_delta': {
        const delta = (ev.delta as Json) ?? {};
        if (typeof delta.stop_reason === 'string') state.stopReason = delta.stop_reason;
        const usage = (ev.usage as Json) ?? {};
        if (usage.output_tokens != null) state.usage.output = Number(usage.output_tokens);
        return null;
      }
      case 'error': {
        const err = (ev.error as Json) ?? {};
        throw new Error(`stream error: ${String(err.type ?? 'unknown')}: ${String(err.message ?? '')}`);
      }
      default:
        return null;
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep = buffer.indexOf('\n\n');
    while (sep >= 0) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      if (data) {
        const text = dispatch(data);
        if (text) yield text;
      }
      sep = buffer.indexOf('\n\n');
    }
  }
}

export interface AssistantOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/** One request to the Messages API. Isolated so a later SDK swap touches only this function. */
async function requestTurn(messages: MessageParam[], opts: AssistantOptions): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = {
    model: opts.model || DEFAULT_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    stream: true,
    // Chat is a low-effort route: short answers, one or two tool calls.
    output_config: { effort: 'low' },
    // Policy declines are re-run server-side on Anthropic's recommended fallback
    // instead of reaching the customer as a dead end.
    fallbacks: 'default',
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: anthropicTools(),
    messages,
  };
  const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]) : AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  return fetchImpl(MESSAGES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify(body),
    signal,
  });
}

const HANDOFF = `I can't take that one here. The shop answers on WhatsApp: ${SITE_ORIGIN}/wa`;

/**
 * Drive one customer turn: stream the answer, run any tools Claude asks for
 * (at most MAX_TOOL_ROUNDS rounds), and finish with 'done' or 'error'.
 */
export async function* runAssistant(turns: ChatTurn[], opts: AssistantOptions): AsyncGenerator<AssistantEvent> {
  const messages: MessageParam[] = turns.map((t) => ({ role: t.role, content: t.content }));
  const usage = { input: 0, output: 0 };
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    let res: Response;
    try {
      res = await requestTurn(messages, opts);
    } catch (e) {
      if (opts.signal?.aborted) return;
      console.error('[assistant] upstream unreachable', e instanceof Error ? e.message : e);
      yield { type: 'error', code: 'UNAVAILABLE', message: 'The assistant is not available just now. Please try again in a moment.' };
      return;
    }
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      console.error(`[assistant] upstream ${res.status}: ${detail.slice(0, 300)}`);
      if (res.status === 429 || res.status === 529) yield { type: 'error', code: 'BUSY', message: 'The assistant is busy right now. Please try again in a minute.' };
      else yield { type: 'error', code: 'UNAVAILABLE', message: 'The assistant is not available just now. Please try again in a moment.' };
      return;
    }
    const blocks: ContentBlock[] = [];
    const state = { stopReason: null as string | null, usage };
    try {
      for await (const text of readTurn(res.body, (b) => blocks.push(b), state)) yield { type: 'text', text };
    } catch (e) {
      if (opts.signal?.aborted) return;
      console.error('[assistant] stream failed', e instanceof Error ? e.message : e);
      yield { type: 'error', code: 'FAILED', message: 'The answer was cut off. Please ask again.' };
      return;
    }
    const toolUses = blocks.filter((b) => b.type === 'tool_use');
    if (state.stopReason === 'refusal') {
      yield { type: 'text', text: HANDOFF };
      yield { type: 'done', usage: { ...usage } };
      return;
    }
    if (state.stopReason === 'max_tokens' && toolUses.length) {
      // A truncated tool input must never run; say so instead.
      yield { type: 'text', text: 'That took more than I can do in one go. Could you ask it in a smaller piece?' };
      yield { type: 'done', usage: { ...usage } };
      return;
    }
    if (state.stopReason === 'pause_turn') {
      messages.push({ role: 'assistant', content: blocks });
      continue;
    }
    if (state.stopReason !== 'tool_use' || toolUses.length === 0) {
      yield { type: 'done', usage: { ...usage } };
      return;
    }
    if (round === MAX_TOOL_ROUNDS) {
      yield { type: 'text', text: `I could not finish that lookup. ${HANDOFF}` };
      yield { type: 'done', usage: { ...usage } };
      return;
    }
    messages.push({ role: 'assistant', content: blocks });
    const results: ContentBlock[] = [];
    for (const use of toolUses) {
      const name = String(use.name ?? '');
      yield { type: 'tool', name };
      let content: string;
      let isError = false;
      if (!isToolName(name)) { content = `Unknown tool "${name}".`; isError = true; }
      else if (!use.input || typeof use.input !== 'object' || Array.isArray(use.input)) { content = 'The tool input was not valid JSON; try again with a smaller input.'; isError = true; }
      else {
        try {
          const out = await callTool(name, use.input as Json);
          const textOut = Array.isArray(out.content) ? (out.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n') : '';
          content = textOut || JSON.stringify(out.structuredContent ?? {});
          isError = out.isError === true;
        } catch (e) {
          console.error(`[assistant] tool ${name} failed`, e instanceof Error ? e.message : e);
          content = 'The shop could not be reached for that just now.';
          isError = true;
        }
      }
      results.push({ type: 'tool_result', tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
  }
}
