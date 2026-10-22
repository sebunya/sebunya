import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runAssistant, type Usage } from '../../apps/web/src/lib/assistant';

/**
 * A chat closed mid-answer kept the whole multi-round reservation (5-10x a real turn) for good; ~430 abandoned answers
 * a month would switch the paid layer off (2026-10-22 review). runAssistant now hands its caller a probe of what the
 * provider has reported, the round in flight included, and goldieTurn settles on it (plus one round's output) when a
 * turn ends without 'done' or 'error'.
 */
const sse = (events: unknown[]) => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');

describe('a turn the shopper abandons is settled on real usage', () => {
  it('the probe reports the input the provider billed for the round in flight', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(sse([
          { type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 1234, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
        ])));
        // ...and the stream never finishes: the shopper closes the chat.
      },
    });
    let probe: (() => Usage) | null = null;
    const run = runAssistant([{ role: 'user', content: 'hi' }], {
      apiKey: 'test', fetchImpl: (async () => new Response(body, { status: 200 })) as never,
      onUsageProbe: (p) => { probe = p; },
    });
    const first = await run.next();
    expect(first.value).toMatchObject({ type: 'text', text: 'Hello' });
    await run.return(undefined); // the reader stops, as when the response stream is cancelled
    expect(probe).not.toBeNull();
    expect(probe!().inputTokens).toBe(1234);
  });

  it('goldieTurn settles an unsettled turn in its finally, on the probe plus one round of output', () => {
    const src = readFileSync(new URL('../../apps/web/src/lib/goldieTurn.ts', import.meta.url), 'utf8');
    expect(src).toContain("outcome: 'ABORTED', usage: { ...u, outputTokens: u.outputTokens + admission.maxOutputTokens }");
    expect(src).toMatch(/if \(u && u\.inputTokens > 0\)/);
  });
});
