import type { AiAnswerProvider } from '../../../application/ports/AiVisibility';
import type { ProviderId } from '../../../domain/ai-visibility/Evidence';
import { AnthropicProvider } from './AnthropicProvider';
import { GeminiProvider } from './GeminiProvider';
import { OpenAiProvider } from './OpenAiProvider';
import { PerplexityProvider } from './PerplexityProvider';

/** The provider registry: the only place provider-specific code is chosen. */
export function createProviderRegistry(): Record<ProviderId, AiAnswerProvider> {
  return {
    OPENAI: new OpenAiProvider(),
    ANTHROPIC: new AnthropicProvider(),
    GEMINI: new GeminiProvider(),
    PERPLEXITY: new PerplexityProvider(),
  };
}
