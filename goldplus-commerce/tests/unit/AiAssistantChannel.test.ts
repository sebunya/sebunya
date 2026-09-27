import { describe, expect, it } from 'vitest';
import { classifyChannel, CHANNELS } from '../../apps/api/src/domain/measurement/Channels';
import { CHANNEL_LABELS } from '../../apps/api/src/domain/measurement/ChannelReport';

describe('AI assistant channel', () => {
  it('is a known channel with a label', () => {
    expect(CHANNELS).toContain('ai_assistant');
    expect(CHANNEL_LABELS.ai_assistant).toBe('AI assistants');
  });
  it('classifies ChatGPT links by utm_source', () => {
    expect(classifyChannel({ source: 'chatgpt.com' })).toBe('ai_assistant');
    expect(classifyChannel({ source: 'ChatGPT.com', referrerHost: 'chatgpt.com' })).toBe('ai_assistant');
  });
  it('classifies assistants by referrer, before search', () => {
    for (const host of ['gemini.google.com', 'www.perplexity.ai', 'copilot.microsoft.com', 'claude.ai', 'chat.openai.com']) {
      expect(classifyChannel({ referrerHost: host })).toBe('ai_assistant');
    }
  });
  it('keeps ordinary search, paid clicks and tagged campaigns unchanged', () => {
    expect(classifyChannel({ referrerHost: 'www.google.com' })).toBe('organic_search');
    expect(classifyChannel({ referrerHost: 'www.bing.com' })).toBe('organic_search');
    expect(classifyChannel({ source: 'chatgpt.com', clickIdTypes: ['gclid'] })).toBe('paid_search');
    expect(classifyChannel({ source: 'newsletter', medium: 'email' })).toBe('email');
    expect(classifyChannel({ source: 'partner' })).toBe('other');
  });
});
