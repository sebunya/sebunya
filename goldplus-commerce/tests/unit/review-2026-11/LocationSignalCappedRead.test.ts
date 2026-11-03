import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../apps/web/src/lib/locationSignals', () => ({ sendLocationSignal: async () => undefined }));
import { POST } from '../../../apps/web/src/pages/location-signal';

describe('/location-signal reads its body with a cap', () => {
  it('refuses a declared oversized body without reading it', async () => {
    const req = new Request('https://x/location-signal', { method: 'POST', headers: { 'content-length': '5000000' }, body: 'x'.repeat(10) });
    expect((await (POST as any)({ request: req, locals: {} })).status).toBe(413);
  });
  it('refuses a streamed body past 1000 bytes', async () => {
    const req = new Request('https://x/location-signal', { method: 'POST', body: JSON.stringify({ a: 'x'.repeat(2000) }) });
    req.headers.delete('content-length');
    expect((await (POST as any)({ request: req, locals: {} })).status).toBe(413);
  });
  it('accepts a small signal', async () => {
    const req = new Request('https://x/location-signal', { method: 'POST', body: JSON.stringify({ kind: 'quote_shown' }) });
    expect((await (POST as any)({ request: req, locals: {} })).status).toBe(204);
  });
});
