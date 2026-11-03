import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { bulkQuoteKey } from '../../apps/web/src/lib/goldieCare';
import { cartCountFromPage } from '../../apps/web/src/scripts/goldie-panel';

const src = (p: string) => readFileSync(p, 'utf8');
const ID = (n: number) => `${String(n).padStart(8, '0')}-1111-2222-3333-444444444444`;

describe('review 232/231/233: Goldie web fixes', () => {
  it('bulk quote key: never a shared placeholder, and every line counts', () => {
    const lines = [1, 2, 3, 4].map((n) => ({ productId: ID(n), count: 1 }));
    const a = bulkQuoteKey(null, '0772000001', 'Ann', lines);
    expect(a).not.toContain('-x-');
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,80}$/);
    expect(bulkQuoteKey(null, '0772000002', 'Bob', lines)).not.toBe(a);
    const changedFourth = lines.map((l, i) => (i === 3 ? { ...l, count: 2 } : l));
    expect(bulkQuoteKey('conv-123456', '0772000001', 'Ann', changedFourth)).not.toBe(bulkQuoteKey('conv-123456', '0772000001', 'Ann', lines));
    expect(bulkQuoteKey('conv-123456', '0772000001', 'Ann', lines)).toBe(bulkQuoteKey('conv-123456', '0772000001', 'Ann', lines));
  });

  it('cart badge comes from the cart page the server returned, never +1', () => {
    expect(cartCountFromPage('<script>window.__GPNAV={"signedIn":false,"cartCount":3}</script>')).toBe(3);
    expect(cartCountFromPage('<html></html>')).toBeNull();
    expect(src('apps/web/src/scripts/goldie-panel.ts')).not.toContain("|| 0) + 1");
  });

  it('Start over is off while an answer streams', () => {
    const p = src('apps/web/src/scripts/goldie-panel.ts');
    expect(p).toContain("clearBtn.addEventListener('click', () => { if (busy) return;");
    expect(p).toContain('clearBtn.disabled = true');
  });

  it('request id is marked seen only after admission; a closed stream does not throw', () => {
    const c = src('apps/web/src/pages/api/assistant/chat.ts');
    expect(c.indexOf('markSeen(requestId)')).toBeGreaterThan(c.indexOf("if (prepared.kind === 'refused')"));
    expect(c).toContain('try { controller.close(); } catch');
  });

  it('the concurrency slot is taken in prepareTurn, next to the check', () => {
    const t = src('apps/web/src/lib/goldieTurn.ts');
    expect(t).toContain("if (route === 'ai') inFlight += 1;");
    expect(t.match(/inFlight \+= 1/g)).toHaveLength(1);
  });

  it('the WhatsApp turn route catches a throw and still answers in JSON', () => {
    expect(src('apps/web/src/pages/api/internal/goldie/turn.ts')).toContain("console.error('[goldie/turn] unexpected'");
  });

  it('usage of an aborted round is counted once', () => {
    expect(src('apps/web/src/lib/assistant.ts')).toMatch(/add\(state\.usage\);\n\s*\/\/ Counted once[^\n]*\n\s*current = null;/);
  });

  it('Spotify callback checks state before touching the sign-in cookies', () => {
    const s = src('apps/web/src/pages/admin/advertising/spotify/callback.astro');
    expect(s.indexOf('const stateMatches')).toBeLessThan(s.indexOf('if (spotifyError)') === -1 ? Infinity : s.indexOf('else if (spotifyError)'));
    expect(s).toContain('if (stateMatches) {\n    Astro.cookies.delete(SPOTIFY_STATE_COOKIE');
  });

  it('measurement page drops the unused match-quality call; proxy uses apiBase', () => {
    expect(src('apps/web/src/pages/admin/measurement/index.astro')).not.toContain('/api/admin/measurement/match-quality');
    expect(src('apps/web/src/pages/api/admin/measurement/[...path].ts')).toContain('const API_BASE = apiBase;');
  });
});
