import { describe, it, expect } from 'vitest';
import { OpenAiProvider } from '../../apps/api/src/infrastructure/ai-visibility/providers/OpenAiProvider';
import { AnthropicProvider } from '../../apps/api/src/infrastructure/ai-visibility/providers/AnthropicProvider';
import { GeminiProvider } from '../../apps/api/src/infrastructure/ai-visibility/providers/GeminiProvider';
import { PerplexityProvider } from '../../apps/api/src/infrastructure/ai-visibility/providers/PerplexityProvider';

/**
 * Provider response parsing. Payload shapes follow each provider's documented
 * response format. What counts as a CITATION is exactly what the answer cites
 * — never every page a search visited — and engine self-links are dropped.
 */
const input = { query: 'where to buy a power bank in kampala', location: { country: 'UG', city: 'Kampala' } };

describe('OpenAI Responses + web_search', () => {
  const p = new OpenAiProvider();
  it('reads output_text and url_citation annotations; counts search calls', () => {
    const raw = {
      id: 'resp_1', model: 'gpt-4.1-mini-2025-04-14',
      output: [
        { type: 'web_search_call', action: { type: 'search', query: 'power bank kampala' } },
        { type: 'message', content: [{ type: 'output_text', text: 'GoldPlus sells power banks.', annotations: [
          { type: 'url_citation', url: 'https://shopgoldplus.com/power?utm_source=openai', title: 'Power' },
          { type: 'url_citation', url: 'https://shopgoldplus.com/power?utm_source=openai', title: 'dup' },
          { type: 'url_citation', url: 'https://chatgpt.com/share/x', title: 'self' },
        ] }] },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const a = p.normalize(raw, { model: 'gpt-4.1-mini' }, 1200, input);
    expect(a.answerText).toBe('GoldPlus sells power banks.');
    expect(a.citationSupport).toBe('SUPPORTED');
    expect(a.citations).toHaveLength(1);
    expect(a.usage).toMatchObject({ inputTokens: 100, outputTokens: 50, searchCalls: 1 });
    expect(a.appliedLocation).toBe('Kampala, UG');
    expect(a.model).toBe('gpt-4.1-mini-2025-04-14');
  });
  it('an answer with no search is UNSUPPORTED for citations', () => {
    const a = p.normalize({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }] }, { model: 'm' }, 1, input);
    expect(a.citationSupport).toBe('UNSUPPORTED');
    expect(a.appliedLocation).toBeNull();
  });
  it('validates key shape without calling the API', () => {
    expect(p.validateConfiguration({ apiKey: 'nope', model: 'gpt-4.1-mini' }).ok).toBe(false);
  });
});

describe('Anthropic Messages + web_search tool', () => {
  const p = new AnthropicProvider();
  it('counts only text-block citations, not the retrieved result list', () => {
    const raw = {
      model: 'claude-sonnet-5',
      content: [
        { type: 'server_tool_use', name: 'web_search', input: { query: 'power bank kampala' } },
        { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://notcited.example/x' }] },
        { type: 'text', text: 'Oraimo is popular. ', citations: [{ type: 'web_search_result_location', url: 'https://ug.oraimo.com/p', title: 'Oraimo' }] },
        { type: 'text', text: 'Also GoldPlus.' },
      ],
      usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 1 } },
    };
    const a = p.normalize(raw, { model: 'claude-sonnet-5' }, 1, input);
    expect(a.answerText).toBe('Oraimo is popular. Also GoldPlus.');
    expect(a.citations.map((c) => c.url)).toEqual(['https://ug.oraimo.com/p']);
    expect(a.citationSupport).toBe('SUPPORTED');
  });
});

describe('Gemini grounding', () => {
  const p = new GeminiProvider();
  it('keeps only supported chunks and resolves redirect links to the titled site', () => {
    const raw = {
      modelVersion: 'gemini-2.5-flash',
      candidates: [{
        content: { parts: [{ text: 'Try Jumia or GoldPlus.' }] },
        groundingMetadata: {
          webSearchQueries: ['power bank kampala'],
          groundingChunks: [
            { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'jumia.ug' } },
            { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/def', title: 'unused.example' } },
          ],
          groundingSupports: [{ groundingChunkIndices: [0] }],
        },
      }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7 },
    };
    const a = p.normalize(raw, { model: 'gemini-2.5-flash' }, 1);
    expect(a.citations.map((c) => c.url)).toEqual(['https://jumia.ug/']);
    expect(a.appliedLocation).toBeNull();
    expect(a.citationSupport).toBe('SUPPORTED');
  });
  it('no grounding metadata = citations unsupported', () => {
    expect(p.normalize({ candidates: [{ content: { parts: [{ text: 'x' }] } }] }, { model: 'gemini-2.5-flash' }, 1).citationSupport).toBe('UNSUPPORTED');
  });
});

describe('Perplexity Sonar', () => {
  const p = new PerplexityProvider();
  it('prefers search_results, falls back to citations[]', () => {
    const a = p.normalize({ model: 'sonar', choices: [{ message: { content: 'x' } }], search_results: [{ url: 'https://a.com/1', title: 'A' }], citations: ['https://b.com'] }, { model: 'sonar' }, 1);
    expect(a.citations.map((c) => c.url)).toEqual(['https://a.com/1']);
    const b = p.normalize({ choices: [{ message: { content: 'x' } }], citations: ['https://b.com/2'] }, { model: 'sonar' }, 1);
    expect(b.citations.map((c) => c.url)).toEqual(['https://b.com/2']);
  });
  it('uses a provider-reported cost when present', () => {
    const a = p.normalize({ choices: [{ message: { content: 'x' } }], citations: [], usage: { cost: { total_cost: 0.006 } } }, { model: 'sonar' }, 1);
    expect(a.costUsd).toBe(0.006);
  });
});

describe('provider transport timeout', () => {
  it('covers the body, not just the headers: a stalled body is a TIMEOUT', async () => {
    const { postJson } = await import('../../apps/api/src/infrastructure/ai-visibility/providers/http');
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_u: unknown, init: { signal: AbortSignal }) => ({
      ok: true, status: 200,
      text: () => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    })) as any;
    try {
      await expect(postJson('https://api.example.com', {}, {}, 30)).rejects.toMatchObject({ code: 'TIMEOUT' });
    } finally { globalThis.fetch = orig; }
  });

  it('a body cut off after the headers keeps the status and counts as possibly billed', async () => {
    const { postJson, possiblyBilled } = await import('../../apps/api/src/infrastructure/ai-visibility/providers/http');
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, status: 200, text: () => Promise.reject(new TypeError('socket reset')) })) as any;
    try {
      const e = await postJson('https://api.example.com', {}, {}, 5000).catch((x) => x);
      expect(e).toMatchObject({ code: 'TIMEOUT', status: 200 });
      expect(possiblyBilled(e)).toBe(true);
    } finally { globalThis.fetch = orig; }
  });
});
