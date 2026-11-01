import { describe, expect, it } from 'vitest';
import { readBodyCapped } from '../../apps/web/src/lib/boundedBody';

describe('readBodyCapped', () => {
  it('a body that errors mid-read is a failure, not a truncated success', async () => {
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) { if (!sent) { sent = true; c.enqueue(new TextEncoder().encode('{"a":')); } else c.error(new Error('reset')); },
    });
    const req = new Request('https://x.example/', { method: 'POST', body, duplex: 'half' } as RequestInit);
    expect(await readBodyCapped(req, 1000)).toEqual({ ok: false, reason: 'READ_ERROR' });
  });

  it('a whole body still reads', async () => {
    const req = new Request('https://x.example/', { method: 'POST', body: 'hello' });
    expect(await readBodyCapped(req, 1000)).toEqual({ ok: true, text: 'hello' });
  });
});
