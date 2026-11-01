import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { SharpVariantGenerator } from '../../apps/api/src/infrastructure/media/SharpVariantGenerator';

const read = (p: string) => readFileSync(path.resolve(__dirname, '../..', p), 'utf8');
const sharp = createRequire(path.resolve(__dirname, '../../apps/api/package.json'))('sharp');

/** The last confirmed items of the 2026-10-22 review. */
describe('2026-10-22 review: leftovers', () => {
  it('WhatsApp waits for a whole Goldie turn, and still inside the three-minute recovery window', async () => {
    const { GOLDIE_BRAIN_TIMEOUT_MS, HttpGoldieBrain } = await import('../../apps/api/src/infrastructure/assistant/GoldieChannelAdapters');
    // One model call alone may take 60 s in the web; a turn with a tool round makes at least two.
    expect(GOLDIE_BRAIN_TIMEOUT_MS).toBeGreaterThan(2 * 60_000);
    // Burst wait (10 s at most) + the turn + the send (10 s) must finish before recovery picks the message up.
    expect(10_000 + GOLDIE_BRAIN_TIMEOUT_MS + 10_000).toBeLessThan(180_000);
    expect(read('apps/api/src/application/use-cases/assistant/GoldieChannelUseCases.ts')).toMatch(/new Date\(t - 180_000\)/);

    const prev = process.env.INTERNAL_API_KEY;
    process.env.INTERNAL_API_KEY = 'k'.repeat(40);
    let signal: AbortSignal | undefined;
    const brain = new HttpGoldieBrain('http://web:4321', (async (_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Response(JSON.stringify({ success: true, data: { text: 'hi' } }), { status: 200 });
    }) as unknown as typeof fetch);
    expect(await brain.turn({ channel: 'whatsapp', conversationKey: 'k', verifiedPhone: '256772123456', name: null, turns: [{ role: 'user', content: 'hi' }] } as never)).toMatchObject({ text: 'hi' });
    expect(signal?.aborted).toBe(false);
    process.env.INTERNAL_API_KEY = prev;
  });

  it('a channel turn the API gave up on stops in the web (its budget is settled, no answer runs on unsent)', () => {
    expect(read('apps/web/src/pages/api/internal/goldie/turn.ts')).toMatch(/apiKey: String\(process\.env\.ANTHROPIC_API_KEY\), signal: request\.signal,/);
  });

  it('a camera photo is decoded once for all twelve renditions, and they come out upright at the right sizes', async () => {
    // 4000×3000 pixels tagged "rotate 90°": a 3000×4000 portrait.
    const buffer = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#96CC06' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const src = read('apps/api/src/infrastructure/media/SharpVariantGenerator.ts');
    // Only the metadata read and the one decode touch the received bytes in generateNow.
    const generateNow = src.slice(src.indexOf('private async generateNow'));
    expect(generateNow.match(/sharp\(args\.buffer/g)).toHaveLength(2);
    const out = await new SharpVariantGenerator().generate({
      buffer, mime: 'image/jpeg', checksum: 'x',
      saveVariant: async (key) => ({ url: `/u/${key}`, storageKey: key }),
    });
    expect({ width: out.width, height: out.height }).toEqual({ width: 3000, height: 4000 });
    expect(out.variants).toHaveLength(12);
    for (const v of out.variants) {
      expect(v.width).toBe({ thumb: 160, card: 480, pdp: 1024, zoom: 2048 }[v.purpose]);
      expect(Math.abs(v.height - (v.width * 4) / 3)).toBeLessThanOrEqual(1);
    }
  }, 30_000); // a real 12 MP decode into 12 renditions (AVIF included): ~5 s locally, more on CI
});
