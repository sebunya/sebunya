import { ProviderCallError, type AiAnswerProvider, type ProviderCallConfig, type QueryExecutionInput } from '../../../application/ports/AiVisibility';
import type { NormalizedAnswer } from '../../../domain/ai-visibility/Evidence';
import { asArray, dedupeCitations, num, postJson } from './http';

/**
 * Anthropic Messages API with the server-side web_search tool, forced via
 * tool_choice so every answer is a searched answer.
 * Answer: content[type=text].text
 * Citations: ONLY content[type=text].citations[type=web_search_result_location]
 * — sources the answer text cites. The raw web_search_tool_result list (pages
 * retrieved but not necessarily used) is deliberately not counted.
 * A web_search_tool_result carrying an error_code is a failed call even though
 * the HTTP status was 200.
 */
export class AnthropicProvider implements AiAnswerProvider {
  readonly id = 'ANTHROPIC' as const;
  readonly displayName = 'Claude (Anthropic)';
  readonly appliesLocation = true;

  validateConfiguration(cfg: Pick<ProviderCallConfig, 'apiKey' | 'model'>) {
    if (!cfg.apiKey?.startsWith('sk-ant-')) return { ok: false as const, reason: 'An Anthropic key starts with "sk-ant-".' };
    if (!/^claude-/.test(cfg.model ?? '')) return { ok: false as const, reason: 'Claude model ids start with "claude-".' };
    return { ok: true as const };
  }

  async healthcheck(cfg: ProviderCallConfig) {
    try {
      const { raw } = await this.executeQuery({ query: 'Reply with the single word: ok', location: null }, { ...cfg, webSearch: false });
      return { ok: true as const, servedModel: String((raw as { model?: string })?.model ?? '') || null };
    } catch (e) {
      return { ok: false as const, reason: (e as Error).message };
    }
  }

  async executeQuery(input: QueryExecutionInput, cfg: ProviderCallConfig) {
    const tool: Record<string, unknown> = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 };
    if (input.location) tool.user_location = { type: 'approximate', country: input.location.country, ...(input.location.city ? { city: input.location.city } : {}) };
    const body: Record<string, unknown> = { model: cfg.model, max_tokens: 2048, messages: [{ role: 'user', content: input.query }] };
    if (cfg.webSearch) { body.tools = [tool]; body.tool_choice = { type: 'tool', name: 'web_search' }; }
    const { json, latencyMs } = await postJson('https://api.anthropic.com/v1/messages', { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' }, body, cfg.timeoutMs);
    for (const block of asArray((json as any)?.content)) {
      if (block?.type === 'web_search_tool_result' && block?.content?.error_code) {
        throw new ProviderCallError(`Web search failed: ${block.content.error_code}`, 200, 'HTTP');
      }
    }
    return { raw: json, latencyMs };
  }

  normalize(raw: unknown, cfg: Pick<ProviderCallConfig, 'model'>, latencyMs: number, input: QueryExecutionInput): NormalizedAnswer {
    const r = raw as any;
    const texts: string[] = [];
    const cites: Array<{ url: string; title: string | null }> = [];
    const searchQueries: string[] = [];
    let searchCalls = 0;
    for (const b of asArray(r?.content)) {
      if (b?.type === 'server_tool_use' && b?.name === 'web_search') {
        searchCalls += 1;
        if (typeof b?.input?.query === 'string') searchQueries.push(b.input.query);
      }
      if (b?.type !== 'text') continue;
      if (typeof b.text === 'string') texts.push(b.text);
      for (const c of asArray(b.citations)) {
        if (c?.type === 'web_search_result_location' && typeof c.url === 'string') cites.push({ url: c.url, title: c.title ?? null });
      }
    }
    const serverSearches = num(r?.usage?.server_tool_use?.web_search_requests);
    return {
      provider: 'ANTHROPIC',
      model: String(r?.model ?? cfg.model),
      answerText: texts.join(''),
      citationSupport: searchCalls > 0 ? 'SUPPORTED' : 'UNSUPPORTED',
      citations: dedupeCitations(cites),
      appliedLocation: input.location && searchCalls > 0 ? [input.location.city, input.location.country].filter(Boolean).join(', ') : null,
      usage: { inputTokens: num(r?.usage?.input_tokens), outputTokens: num(r?.usage?.output_tokens), searchCalls: serverSearches ?? searchCalls },
      costUsd: null,
      latencyMs,
      rawMetadata: { requestedModel: cfg.model, servedModel: r?.model ?? null, searchQueries, responseId: r?.id ?? null, stopReason: r?.stop_reason ?? null },
    };
  }
}
