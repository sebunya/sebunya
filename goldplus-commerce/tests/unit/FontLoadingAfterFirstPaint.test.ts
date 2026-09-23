import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/**
 * Storefront web fonts load after the first paint (2026-09-13). Under Lighthouse's
 * mobile simulation the eight font files requested with the document cost ~300 ms of
 * FCP and LCP; text now paints in metric-matched local fallbacks and the brand fonts
 * swap in from /fonts/faces.css without moving the layout.
 */
describe('web fonts load after the first paint', () => {
  it('no downloadable @font-face is inlined into storefront pages', () => {
    for (const f of ['apps/web/src/styles/global.css', 'apps/web/src/components/GpNav.astro', 'apps/web/src/components/hero/HeroSlider.astro']) {
      const src = read(f);
      expect(src, f).not.toMatch(/@font-face\s*\{[^}]*url\(/);
    }
    expect(read('apps/web/src/layouts/BaseLayout.astro')).not.toContain('rel="preload" as="font"');
  });

  it('faces.css declares every brand weight with font-display: swap, and each file exists', () => {
    const css = read('apps/web/public/fonts/faces.css');
    const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(faces).toHaveLength(8);
    for (const w of ['400', '500', '600', '700', '800']) expect(css).toMatch(new RegExp(`'Plus Jakarta Sans';[^}]*font-weight: ${w};`));
    for (const w of ['400', '600', '700']) expect(css).toMatch(new RegExp(`'Poppins';[^}]*font-weight:${w};`));
    for (const face of faces) {
      expect(face).toMatch(/font-display:\s*swap/);
      const url = face.match(/url\('([^']+)'\)/)?.[1];
      expect(url && existsSync(join(root, 'apps/web/public', url)), url).toBe(true);
    }
  });

  it('the layout loads faces.css after first paint, with load, timer and noscript fallbacks', () => {
    const layout = read('apps/web/src/layouts/BaseLayout.astro');
    expect(layout).toMatch(/observe\(\{type:'paint',buffered:true\}\)/);
    expect(layout).toContain('set:html={FONT_LOADER}');
    // Rocket Loader must not defer the loader to after window.load
    expect(layout).toContain('<script nonce={Astro.locals.cspNonce} is:inline data-cfasync="false" set:html={FONT_LOADER}>');
    expect(layout).toContain("addEventListener('load'");
    expect(layout).toContain('setTimeout(go,3000)');
    expect(layout).toMatch(/<noscript><link rel="stylesheet" href="\/fonts\/faces\.css\?v=\d+" \/><\/noscript>/);
  });

  it('the metric-matched fallbacks stay inline and cover Linux/Android metric twins', () => {
    const global = read('apps/web/src/styles/global.css');
    expect(global).toMatch(/'Plus Jakarta Sans Fallback'[^}]*local\('Liberation Sans'\)/);
    for (const f of ['apps/web/src/components/GpNav.astro', 'apps/web/src/components/hero/HeroSlider.astro']) {
      expect((read(f).match(/font-family:'Poppins Fallback'/g) ?? []).length, f).toBe(3);
    }
  });

  it('Cloudflare Web Analytics is installed manually and loads after window.load, never beside the document', () => {
    const layout = read('apps/web/src/layouts/BaseLayout.astro');
    expect(layout).toContain('set:html={CF_BEACON_LOADER}');
    expect(layout).toMatch(/CF_BEACON_LOADER = `[^`]*addEventListener\('load',idle\)/);
    expect(layout).toMatch(/CF_BEACON_LOADER = `[^`]*requestIdleCallback/);
    expect(layout).not.toMatch(/<script[^>]*src="https:\/\/static\.cloudflareinsights\.com/);
  });

  it('the homepage trust strip is hidden for a returning visitor before first paint, not after', () => {
    const layout = read('apps/web/src/layouts/BaseLayout.astro');
    const home = read('apps/web/src/pages/index.astro');
    expect(layout).toContain("localStorage.getItem('goldplus_seen_before')==='true')document.documentElement.classList.add('gp-seen')");
    expect(layout).toContain('set:html={SEEN_FLAG}');
    expect(home).toContain('html.gp-seen #homepage-trust-strip{display:none}');
    expect(read('apps/web/src/lib/returning-user.ts')).toContain('"goldplus_seen_before"');
  });
});

