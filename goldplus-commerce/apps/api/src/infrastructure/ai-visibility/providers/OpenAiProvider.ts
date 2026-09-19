import type { AiAnswerProvider, ProviderCallConfig, QueryExecutionInput } from '../../../application/ports/AiVisibility';
import type { NormalizedAnswer } from '../../../domain/ai-visibility/Evidence';
import { asArray, dedupeCitations, num, postJson } from './http';

/**
 * OpenAI Responses API with the hosted web_search tool, search REQUIRED.
 * Answer: output[type=message].content[type=output_text].text
 * Citations: the url_citation annotations on that text (what the answer cites),
 * not every page the search visited.
 */
export class OpenAiProvider implements AiAnswerProvider {
  readonly id = 'OPENAI' as const;
  readonly displayName = 'ChatGPT (OpenAI)';
  readonly appliesLocation = true;

  validateConfiguration(cfg: Pick<ProviderCallConfig, 'apiKey' | 'model'>) {
    if (!cfg.apiKey?.startsWith('sk-')) return { ok: false as const, reason: 'An OpenAI key starts with "sk-".' };
    if (!cfg.model?.trim()) return { ok: false as const, reason: 'Choose a model.' };
    return { ok: true as const };
  }

  async healthcheck(cfg: ProviderCallConfig) {
    try {
      const { raw } = await this.executeQuery({ query: 'What is the capital of Uganda? Answer in one word.', location: null }, cfg);
      return { ok: true as const, servedModel: String((raw as { model?: string })?.model ?? '') || null };
    } catch (e) {
      return { ok: false as const, reason: (e as Error).message };
    }
  }

  async executeQuery(input: QueryExecutionInput, cfg: ProviderCallConfig) {
    const tool: Record<string, unknown> = { type: 'web_search' };
    if (input.location) tool.user_location = { type: 'approximate', country: input.location.country, ...(input.location.city ? { city: input.location.city } : {}) };
    const body = cfg.webSearch
      ? { model: cfg.model, input: input.query, tools: [tool], tool_choice: 'required' }
      : { model: cfg.model, input: input.query };
    const { json, latencyMs } = await postJson('https://api.openai.com/v1/responses', { authorization: `Bearer ${cfg.apiKey}` }, body, cfg.timeoutMs);
    return { raw: json, latencyMs };
  }

  normalize(raw: unknown, cfg: Pick<ProviderCallConfig, 'model'>, latencyMs: number, input: QueryExecutionInput): NormalizedAnswer {
    const r = raw as any;
    const texts: string[] = [];
    const cites: Array<{ url: string; title: string | null }> = [];
    const searchQueries: string[] = [];
    let searchCalls = 0;
    for (const item of asArray(r?.output)) {
      if (item?.type === 'web_search_call') {
        searchCalls += 1;
        const a = item.action ?? {};
        if (typeof a.query === 'string') searchQueries.push(a.query);
        for (const q of asArray(a.queries)) if (typeof q === 'string') searchQueries.push(q);
      }
      if (item?.type !== 'message') continue;
      for (const part of asArray(item.content)) {
        if (part?.type !== 'output_text') continue;
        if (typeof part.text === 'string') texts.push(part.text);
        for (const an of asArray(part.annotations)) {
          if (an?.type === 'url_citation' && typeof an.url === 'string') cites.push({ url: an.url, title: an.title ?? null });
        }
      }
    }
    return {
      provider: 'OPENAI',
      model: String(r?.model ?? cfg.model),
      answerText: texts.join('\n'),
      citationSupport: searchCalls > 0 ? 'SUPPORTED' : 'UNSUPPORTED',
      citations: dedupeCitations(cites),
      appliedLocation: input.location && searchCalls > 0 ? [input.location.city, input.location.country].filter(Boolean).join(', ') : null,
      usage: { inputTokens: num(r?.usage?.input_tokens), outputTokens: num(r?.usage?.output_tokens), searchCalls },
      costUsd: null,
      latencyMs,
      rawMetadata: { requestedModel: cfg.model, servedModel: r?.model ?? null, searchQueries, responseId: r?.id ?? null },
    };
  }
}
