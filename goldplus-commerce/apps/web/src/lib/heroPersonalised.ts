import type { AstroGlobal } from 'astro';
import { apiBase } from './api';
import heroImages from '../generated/hero-images.json';
import { productSrcset, STAGE_SIZES } from './imageSrcset';

/**
 * The personalised hero rail, fetched ONCE per page render (2026-09-13).
 *
 * Both the page head (to preload the lead slide's image before the browser
 * has parsed the 80 KB of markup that precedes the hero) and the hero
 * component (to render it) need the same answer, so the first caller fetches
 * and the result is cached on Astro.locals for the rest of the request. A
 * failed or slow fetch is cached as null; the hero then falls back to the
 * shared library selection exactly as before.
 */
export interface HeroPersonalisedContext {
  visit: string | null | undefined;
  referred: boolean;
  force: string | null;
}

type Cache = { __gpHeroPersonalised?: unknown | null };

export function heroContextFrom(Astro: Pick<AstroGlobal, 'request' | 'locals'>): HeroPersonalisedContext {
  const reqUrl = new URL(Astro.request.url);
  return {
    visit: (Astro.locals as { gpVisit?: string }).gpVisit,
    referred: reqUrl.searchParams.has('ref') || reqUrl.searchParams.get('utm_campaign') === 'referral',
    force: reqUrl.searchParams.get('gp'),
  };
}

export async function fetchHeroPersonalised(Astro: Pick<AstroGlobal, 'request' | 'locals'>, ctx: HeroPersonalisedContext): Promise<any | null> {
  const cache = Astro.locals as Cache;
  if (cache.__gpHeroPersonalised !== undefined) return cache.__gpHeroPersonalised;
  let json: any | null = null;
  try {
    const qs = new URLSearchParams({ cart: '0', ref: ctx.referred ? '1' : '0' });
    if (ctx.force) qs.set('force', ctx.force);
    const res = await fetch(`${apiBase}/hero/personalised?${qs.toString()}`, {
      headers: ctx.visit ? { 'x-gp-visit': ctx.visit } : {},
      signal: AbortSignal.timeout(2500),
    });
    const body = await res.json().catch(() => null);
    json = res.ok && body?.success ? body : null;
  } catch {
    json = null;
  }
  cache.__gpHeroPersonalised = json;
  return json;
}

type HeroManifest = Record<string, { variants: { w: number; url: string }[] }>;
const HERO_IMAGES = heroImages as HeroManifest;
const HERO_SIZES = '(max-width: 640px) 100vw, (max-width: 1100px) 90vw, 1100px';

/** The <link rel=preload> attributes for the lead slide's image, or null when there is nothing to preload. */
export function heroLeadPreload(json: any | null): { href?: string; imagesrcset?: string; imagesizes?: string } | null {
  const slides = Array.isArray(json?.data?.slides) ? json.data.slides : [];
  if (slides.length === 0) return null;
  const leadKey = json.data.lead || slides[0].slideKey;
  const lead = slides.find((s: any) => s.slideKey === leadKey) ?? slides[0];
  if (!lead || lead.media === 'card' || !lead.imageUrl) return null;
  const url = String(lead.imageUrl);
  if (lead.media === 'bleed') {
    const r = HERO_IMAGES[url];
    if (r && r.variants.length > 0) return { imagesrcset: r.variants.map((v) => `${v.url} ${v.w}w`).join(', '), imagesizes: HERO_SIZES };
    return { href: url };
  }
  // stage: the product image painted by the server-rendered stage <img>
  const srcset = productSrcset(url);
  return srcset ? { imagesrcset: srcset, imagesizes: STAGE_SIZES } : { href: url };
}
