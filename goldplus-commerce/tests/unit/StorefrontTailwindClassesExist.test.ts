import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * 2026-09-24 (jury review): 16 class names that Tailwind 3.4 does not have —
 * shadow-xs, text-gray-955, text-red-650, text-slate-350, border-blue-150,
 * active:scale-98 … — appeared ~75 times in the storefront and generated NO
 * CSS. Intended shades, hover and press states silently never shipped.
 *
 * This asks Tailwind itself (context.getClassOrder: null = no CSS) about every
 * Tailwind-SHAPED token (colour / shadow / scale utilities, the families where
 * a typo still looks plausible) in the storefront sources. A new dead token
 * fails. The ones still present in files outside the product group are listed
 * below as a ceiling to burn down, never to grow.
 */

const ROOT = join(__dirname, '../..');
const WEB = join(ROOT, 'apps/web');
const SRC = join(WEB, 'src');
const req = createRequire(join(WEB, 'package.json'));

/** Known dead tokens, by file, still to be fixed by their owners. Ceiling only. */
const KNOWN_ELSEWHERE: Record<string, string[]> = {
  'components/home/CartAwareRail.astro': ['via-gray-850', 'text-gray-350'],
  'pages/account/rewards.astro': ['text-gray-955'],
  'pages/cart.astro': ['shadow-xs'],
  'pages/checkout.astro': ['shadow-xs', 'hover:shadow-xs', 'text-slate-550', 'border-slate-250'],
  'pages/dealers/apply.astro': ['text-gray-955', 'shadow-xs', 'border-slate-250'],
  'pages/forgot-password.astro': ['text-gray-955', 'shadow-xs'],
  'pages/login.astro': ['text-gray-955', 'shadow-xs'],
  'pages/quote-request.astro': ['text-gray-955', 'shadow-xs', 'hover:border-slate-350'],
  'pages/register.astro': ['text-gray-955', 'shadow-xs'],
  'pages/reset-password.astro': ['text-gray-955', 'shadow-xs'],
  'pages/support/fake.astro': ['shadow-xs', 'text-red-650', 'hover:bg-red-750', 'active:scale-98'],
  'pages/support/index.astro': ['shadow-xs'],
  'pages/support/issue.astro': ['shadow-xs'],
  'pages/terms.astro': ['shadow-xs'],
  'pages/privacy.astro': ['shadow-xs'],
  'pages/track-order.astro': ['shadow-xs'],
};

/** The product group's files: these must be clean, full stop. */
const MUST_BE_CLEAN = [
  'pages/products/[slug].astro',
  'components/ProductCard.astro',
  'components/product/ProductGallery.astro',
  'components/recommendations/RecommendationCard.astro',
  'components/recommendations/RecentlyViewedRail.astro',
  'components/product-finder/ProductFinderShell.astro',
  // 2026-09-24 round 2: burned down from the ceiling above; they stay clean.
  'pages/shop.astro',
  'pages/verification/index.astro',
  'pages/index.astro',
  'pages/blog/index.astro',
  'pages/product-finder.astro',
  'components/GpNav.astro',
  'components/HomeCommerceHighlights.astro',
  'components/EmptyState.astro',
  'layouts/BaseLayout.astro',
];

const SHAPED = /^!?-?(?:text|bg|border|ring|ring-offset|from|via|to|fill|stroke|outline|divide|decoration|placeholder|accent|caret|shadow|scale)-[a-z0-9[\]/._%#(),-]+$/;
// CSS property names inside <style> blocks look like utilities; they are not.
const CSS_PROPERTIES = new Set([
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule', 'text-align', 'text-decoration',
  'text-transform', 'text-underline-offset', 'text-overflow', 'text-rendering', 'text-wrap', 'text-shadow',
  'border-color', 'border-radius', 'border-top', 'border-bottom', 'border-left', 'border-right', 'border-top-color',
  'border-width', 'border-style', 'border-collapse', 'outline-offset', 'outline-color', 'outline-width', 'outline-style',
  'box-shadow', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
  'text-decoration-color', 'text-decoration-thickness', 'accent-color', 'caret-color', 'scale-down',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(astro|ts|tsx|js|mjs)$/.test(entry.name)) out.push(p);
  }
  return out;
}

function tokensOf(src: string): string[] {
  const out: string[] = [];
  for (const raw of src.split(/[\s"'`<>={}]+/)) {
    if (!raw || raw.includes('$') || raw.includes(';') || raw.endsWith(':')) continue;
    // The utility is what follows the last variant colon outside [brackets].
    const utility = raw.replace(/\[[^\]]*\]/g, (m) => m.replace(/:/g, '\u0000')).split(':').pop()!.replace(/\u0000/g, ':');
    if (!SHAPED.test(utility) || CSS_PROPERTIES.has(utility)) continue;
    out.push(raw);
  }
  return out;
}

let deadByFile: Record<string, string[]> = {};
let isDead: (token: string) => boolean = () => false;

beforeAll(async () => {
  const resolveConfig = req('tailwindcss/resolveConfig');
  const { createContext } = req('tailwindcss/lib/lib/setupContextUtils');
  const config = (await import(pathToFileURL(join(WEB, 'tailwind.storefront.config.mjs')).href)).default;
  const context = createContext(resolveConfig(config));
  isDead = (token) => context.getClassOrder([token])[0][1] === null;
  const files = walk(SRC).filter((f) => !/\/(pages|components)\/admin\//.test(f) && !f.endsWith('AdminLayout.astro'));
  const byToken = new Map<string, Set<string>>();
  for (const file of files) {
    const rel = relative(SRC, file);
    for (const token of tokensOf(readFileSync(file, 'utf8'))) {
      if (!byToken.has(token)) byToken.set(token, new Set());
      byToken.get(token)!.add(rel);
    }
  }
  const order: Array<[string, bigint | null]> = context.getClassOrder([...byToken.keys()]);
  deadByFile = {};
  for (const [token, position] of order) {
    if (position !== null) continue;
    for (const file of byToken.get(token)!) (deadByFile[file] ??= []).push(token);
  }
});

describe('storefront class names are ones Tailwind actually generates', () => {
  it('the scanner itself sees a dead token (guards against a silently-empty scan)', () => {
    expect(tokensOf('class="shadow-xs text-gray-955 hover:bg-brand-primary"')).toEqual(['shadow-xs', 'text-gray-955', 'hover:bg-brand-primary']);
    expect(tokensOf('.x { border-color: red; stroke-width: 2 }')).toEqual([]);
    // …and Tailwind answers the question the way the finding measured it.
    expect(isDead('shadow-xs')).toBe(true);
    expect(isDead('text-gray-955')).toBe(true);
    expect(isDead('shadow-sm')).toBe(false);
    expect(isDead('text-brand-primaryInk')).toBe(false);
  });

  it('the product pages, cards, rails, gallery and finder carry no dead class', () => {
    for (const file of MUST_BE_CLEAN) expect(deadByFile[file] ?? [], file).toEqual([]);
  });

  it('no NEW dead class appears anywhere in the storefront', () => {
    const unexpected: string[] = [];
    for (const [file, tokens] of Object.entries(deadByFile)) {
      const allowed = new Set(KNOWN_ELSEWHERE[file] ?? []);
      for (const token of tokens) if (!allowed.has(token)) unexpected.push(`${file}: ${token}`);
    }
    expect(unexpected).toEqual([]);
  });
});
