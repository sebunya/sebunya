import type { AiAnswerProvider, ProviderCallConfig, QueryExecutionInput } from '../../../application/ports/AiVisibility';
import type { NormalizedAnswer } from '../../../domain/ai-visibility/Evidence';
import { asArray, dedupeCitations, num, postJson } from './http';

/**
 * Perplexity Sonar (chat completions). Search is always on for Sonar models.
 * Answer: choices[0].message.content
 * Citations: search_results[].{url,title} when present, else citations[] (URLs).
 * Location is not applied (we do not rewrite the question), so appliedLocation is null.
 */
export class PerplexityProvider implements AiAnswerProvider {
  readonly id = 'PERPLEXITY' as const;
  readonly displayName = 'Perplexity';
  readonly appliesLocation = false;

  validateConfiguration(cfg: Pick<ProviderCallConfig, 'apiKey' | 'model'>) {
    if (!cfg.apiKey?.startsWith('pplx-')) return { ok: false as const, reason: 'A Perplexity key starts with "pplx-".' };
    if (!/^sonar/.test(cfg.model ?? '')) return { ok: false as const, reason: 'Use a Sonar model (e.g. "sonar").' };
    return { ok: true as const };
  }

  async healthcheck(cfg: ProviderCallConfig) {
    try {
      const { raw } = await this.executeQuery({ query: 'Reply with the single word: ok', location: null }, cfg);
      return { ok: true as const, servedModel: String((raw as { model?: string })?.model ?? '') || null };
    } catch (e) {
      return { ok: false as const, reason: (e as Error).message };
    }
  }

  async executeQuery(input: QueryExecutionInput, cfg: ProviderCallConfig) {
    const body = { model: cfg.model, messages: [{ role: 'user', content: input.query }] };
    const { json, latencyMs } = await postJson('https://api.perplexity.ai/chat/completions', { authorization: `Bearer ${cfg.apiKey}` }, body, cfg.timeoutMs);
    return { raw: json, latencyMs };
  }

  normalize(raw: unknown, cfg: Pick<ProviderCallConfig, 'model'>, latencyMs: number): NormalizedAnswer {
    const r = raw as any;
    const text = String(asArray(r?.choices)[0]?.message?.content ?? '');
    const sr = asArray(r?.search_results);
    const cites = sr.length > 0
      ? sr.filter((s: any) => typeof s?.url === 'string').map((s: any) => ({ url: s.url, title: s.title ?? null }))
      : asArray(r?.citations).filter((u: unknown) => typeof u === 'string').map((u: string) => ({ url: u, title: null }));
    const hasSourceField = Array.isArray(r?.search_results) || Array.isArray(r?.citations);
    return {
      provider: 'PERPLEXITY',
      model: String(r?.model ?? cfg.model),
      answerText: text,
      citationSupport: hasSourceField ? 'SUPPORTED' : 'UNSUPPORTED',
      citations: dedupeCitations(cites),
      appliedLocation: null,
      usage: { inputTokens: num(r?.usage?.prompt_tokens), outputTokens: num(r?.usage?.completion_tokens), searchCalls: null },
      costUsd: num(r?.usage?.cost?.total_cost),
      latencyMs,
      rawMetadata: { requestedModel: cfg.model, servedModel: r?.model ?? null, responseId: r?.id ?? null },
    };
  }
}
