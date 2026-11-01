import { abuseControlStore } from './RedisAbuseControlStore';
import type { IAssistantCounterStore } from '../../application/ports/IAssistantRepository';

/**
 * The assistant's sliding-window counters ride on the existing distributed
 * abuse-control store (Redis, with its labelled stricter local fallback), so
 * every API replica sees one count per visitor pseudonym and window.
 */
export class AssistantCounterStore implements IAssistantCounterStore {
  async consume(control: string, identity: string, limit: { limit: number; windowMs: number }) {
    const d = await abuseControlStore.consume({ control, endpoint: 'assistant', identity, limit, outagePolicy: 'STRICT' });
    return { count: d.count, degraded: d.degraded };
  }
}
