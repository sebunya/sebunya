import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

/**
 * The ad click id a visitor arrives on must reach the identity graph, or no
 * ad platform can match that visitor's later product views and basket adds
 * (X's default scope sends nothing without it). Until 2026-10-01 the stitch
 * ran only on product and checkout pages and read only the current URL, so
 * a homepage landing from an ad was never stitched: 972 identities in
 * production, none with a click id.
 */
describe('ad click id reaches the identity graph', () => {
  const telemetry = read('apps/web/src/lib/telemetry.ts');
  const attribution = read('apps/web/src/lib/attribution.ts');
  const layout = read('apps/web/src/layouts/BaseLayout.astro');

  it('every page stitches the click id on landing, after the 30-day ad-click record is written', () => {
    const script = layout.slice(layout.indexOf('recordAdClick();'));
    expect(script).toMatch(/recordAdClick\(\);[\s\S]*captureClickIdsServerSide\(\);/);
    expect(layout).toContain("import { recordLandingTouch, captureClickIdsServerSide } from '../lib/telemetry';");
  });

  it('the stitch falls back to the 30-day ad-click record, with the URL and this session\'s capture taking precedence', () => {
    expect(attribution).toMatch(/export function recentAdClickIds\(\): Record<string, string>/);
    expect(telemetry).toContain("import { recentAdClickIds } from './attribution';");
    expect(telemetry).toContain('return { ...recentAdClickIds(), ...stored, ...fresh };');
  });

  it('the stitch posts once per session for the same signals, and never for our own automation', () => {
    const fn = telemetry.slice(telemetry.indexOf('export function captureClickIdsServerSide'), telemetry.indexOf('export function captureIdentityFromAuth'));
    expect(fn).toContain('if (isOwnAutomation()) return;');
    expect(fn).toContain("sessionStorage.getItem('_gp_identity_sent') === signature) return;");
    expect(fn).toContain('fetch(IDENTITY_ENDPOINT, {');
  });

  it('the recent-click reader strips utm_source: the identity endpoint takes click ids only', () => {
    const fn = attribution.slice(attribution.indexOf('export function recentAdClickIds'), attribution.indexOf('export function getCheckoutAttribution'));
    expect(fn).toContain('const { src: _src, ...ids } = recentClickIds();');
  });
});
