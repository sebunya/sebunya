import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAV_ITEM_KEY } from '../../apps/api/src/infrastructure/nav/NavTelemetryService';
import { goldieKey, type PageKey } from '../../apps/web/src/lib/goldieQuestions';

/**
 * The nav telemetry silently DROPS an item key that is not a lowercase slug of up to
 * 32 characters. Goldie's first release named its events 'goldie:pdp', 'goldie:inline:pdp'
 * and so on, so every impression, tap and dismissal was lost from 2026-10-13 09:00 UTC
 * until this fix. Every key the widget can emit is checked against the server's own rule.
 */
const PAGE_KEYS: Array<PageKey | 'pdp' | 'pdp-battery'> = ['batteries', 'chargers', 'power-banks', 'cables', 'audio', 'storage', 'delivery', 'guide', 'home', 'pdp', 'pdp-battery'];

describe('every Goldie telemetry key is one the server records', () => {
  it('teaser, pill, chip, inline, launcher and cart keys all match NAV_ITEM_KEY', () => {
    const keys = [
      goldieKey('launcher'), 'goldie-cart-add', goldieKey('inline', 'pdp'), goldieKey('inline', 'page'),
      ...PAGE_KEYS.flatMap((k) => [goldieKey(k), `${goldieKey(k)}-pill`, `${goldieKey(k)}-chip`]),
    ];
    for (const k of keys) expect(NAV_ITEM_KEY.test(k), k).toBe(true);
  });

  it('no Goldie source emits a colon-separated key again', () => {
    for (const f of ['apps/web/src/components/ShopAssistant.astro', 'apps/web/src/scripts/goldie-panel.ts']) {
      const src = readFileSync(resolve(__dirname, '../..', f), 'utf8');
      expect(src, f).not.toMatch(/['`]goldie:/);
    }
  });
});
