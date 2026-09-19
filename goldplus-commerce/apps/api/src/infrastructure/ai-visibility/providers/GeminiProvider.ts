import type { AiAnswerProvider, ProviderCallConfig, QueryExecutionInput } from '../../../application/ports/AiVisibility';
import type { NormalizedAnswer } from '../../../domain/ai-visibility/Evidence';
import { normalizeHost } from '../../../domain/ai-visibility/Domains';
import { asArray, dedupeCitations, num, postJson } from './http';

/**
 * Gemini generateContent with Google Search grounding.
 * Answer: candidates[0].content.parts[].text
 * Citations: candidates[0].groundingMetadata.groundingChunks[].web — only the
 * chunks the answer's groundingSupports actually reference (all chunks when
 * the response carries no supports).
 * Grounding URIs are vertexaisearch redirect links; the real site is taken
 * from the chunk title, which Gemini sets to the source domain.
 * Location: the API has no location parameter, and we do not rewrite the
 * question to add one, so appliedLocation is always null.
 */
export class GeminiProvider implements AiAnswerProvider {
  readonly id = 'GEMINI' as const;
  readonly displayName = 'Gemini (Google)';
  readonly appliesLocation = false;

  validateConfiguration(cfg: Pick<ProviderCallConfig, 'apiKey' | 'model'>) {
    if (!cfg.apiKey || cfg.apiKey.length < 20) return { ok: false as const, reason: 'Paste a Gemini API key from Google AI Studio.' };
    if (!/^gemini-/.test(cfg.model ?? '')) return { ok: false as const, reason: 'Gemini model ids start with "gemini-".' };
    return { ok: true as const };
  }

  async healthcheck(cfg: ProviderCallConfig) {
    try {
      const { raw } = await this.executeQuery({ query: 'What is the capital of Uganda? Answer in one word.', location: null }, cfg);
      return { ok: true as const, servedModel: String((raw as { modelVersion?: string })?.modelVersion ?? '') || null };
    } catch (e) {
      return { ok: false as const, reason: (e as Error).message };
    }
  }

  async executeQuery(input: QueryExecutionInput, cfg: ProviderCallConfig) {
    const body: Record<string, unknown> = { contents: [{ role: 'user', parts: [{ text: input.query }] }] };
    if (cfg.webSearch) body.tools = [{ google_search: {} }];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
    const { json, latencyMs } = await postJson(url, { 'x-goog-api-key': cfg.apiKey }, body, cfg.timeoutMs);
    return { raw: json, latencyMs };
  }

  normalize(raw: unknown, cfg: Pick<ProviderCallConfig, 'model'>, latencyMs: number): NormalizedAnswer {
    const r = raw as any;
    const cand = asArray(r?.candidates)[0] ?? {};
    const text = asArray(cand?.content?.parts).map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
    const gm = cand?.groundingMetadata ?? null;
    const chunks = asArray(gm?.groundingChunks);
    const supports = asArray(gm?.groundingSupports);
    const used = new Set<number>();
    for (const s of supports) for (const i of asArray(s?.groundingChunkIndices)) if (typeof i === 'number') used.add(i);
    const cites = chunks
      .map((c: any, i: number) => ({ c, i }))
      .filter(({ i }) => supports.length === 0 || used.has(i))
      .map(({ c }) => {
        const uri = String(c?.web?.uri ?? '');
        const title = typeof c?.web?.title === 'string' ? c.web.title : null;
        const host = normalizeHost(uri);
        // Redirect link -> use the source domain Gemini puts in the title.
        const url = host === 'vertexaisearch.cloud.google.com' && title && normalizeHost(title) ? `https://${normalizeHost(title)}/` : uri;
        return { url, title };
      })
      .filter((c) => c.url);
    return {
      provider: 'GEMINI',
      model: String(r?.modelVersion ?? cfg.model),
      answerText: text,
      citationSupport: gm ? 'SUPPORTED' : 'UNSUPPORTED',
      citations: dedupeCitations(cites),
      appliedLocation: null,
      usage: { inputTokens: num(r?.usageMetadata?.promptTokenCount), outputTokens: num(r?.usageMetadata?.candidatesTokenCount), searchCalls: asArray(gm?.webSearchQueries).length || null },
      costUsd: null,
      latencyMs,
      rawMetadata: { requestedModel: cfg.model, servedModel: r?.modelVersion ?? null, searchQueries: asArray(gm?.webSearchQueries), finishReason: cand?.finishReason ?? null, responseId: r?.responseId ?? null, citationsAreSiteRoots: true },
    };
  }
}
