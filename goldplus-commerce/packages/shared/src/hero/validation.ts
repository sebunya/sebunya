import { HERO_MEDIA, HERO_THEMES, HERO_TINTS, type HeroSlideSeed } from './library';

/**
 * Hero-slide validation and sanitisation (2026-08-07).
 *
 * Two jobs, both load-bearing:
 *
 *  1. GUARD RAILS (§2.5). A CMS that lets someone break the homepage is worse
 *     than code. Character limits are the widths the layout was designed
 *     around; over them the panel overflows on a 375px phone. These are
 *     reported, never silently truncated.
 *
 *  2. THE <em> BOUNDARY (§2.2). The headline is rendered as raw HTML so a
 *     marketer can wrap accent words in <em>…</em>. That means the headline is
 *     an XSS sink, and this is the only thing standing in front of it. Exactly
 *     one tag is allowed — <em> / </em> — and EVERYTHING else is escaped. A
 *     marketer typing <script> gets the literal text, not a script.
 */

export const HERO_LIMITS = {
  kicker: 28,
  headline: 52, // measured on the VISIBLE text, with <em> stripped — the tag is not width
  subcopy: 140,
  ctaLabel: 24,
  finePrint: 90,
  imageAlt: 160,
} as const;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Return a headline safe to render with set:html: the visible text is escaped,
 * then ONLY <em>/</em> are restored. No attributes, no other tags, no
 * event handlers can survive. Order matters — escape first, unescape the two
 * allowed tags second.
 */
export const sanitiseHeadline = (raw: string): string => {
  const escaped = escapeHtml(raw ?? '');
  return escaped
    .replace(/&lt;em&gt;/gi, '<em>')
    .replace(/&lt;\/em&gt;/gi, '</em>');
};

/** The visible text of a headline, with the <em> wrapping removed — for length checks. */
export const headlineVisibleText = (raw: string): string =>
  (raw ?? '').replace(/<\/?em>/gi, '');

/** Balanced <em>? An unbalanced tag would leak green across the rest of the copy. */
const emBalanced = (raw: string): boolean => {
  const opens = (raw.match(/<em>/gi) || []).length;
  const closes = (raw.match(/<\/em>/gi) || []).length;
  return opens === closes;
};

export interface HeroSlideFieldErrors {
  field: string;
  message: string;
}

/**
 * Validate one editable slide. Returns the errors an operator must fix; an
 * empty array means the slide is safe to store and render.
 *
 * `enabled` slides are held to the full contract. A DISABLED slide is checked
 * only for the things that would corrupt storage, so a half-finished draft can
 * be parked out of rotation without passing every rule first.
 */
export const validateHeroSlide = (slide: Partial<HeroSlideSeed>): HeroSlideFieldErrors[] => {
  const errors: HeroSlideFieldErrors[] = [];
  const add = (field: string, message: string) => errors.push({ field, message });

  if (!slide.slideKey || !/^[a-z][a-z0-9]{1,23}$/.test(slide.slideKey)) {
    add('slideKey', 'The slide key is locked and must be a short lowercase identifier.');
  }
  if (slide.theme && !HERO_THEMES.includes(slide.theme)) add('theme', `theme must be one of ${HERO_THEMES.join(', ')}.`);
  if (slide.tint && !HERO_TINTS.includes(slide.tint)) add('tint', `tint must be one of ${HERO_TINTS.join(', ')}.`);
  if (slide.media && !HERO_MEDIA.includes(slide.media)) add('media', `media must be one of ${HERO_MEDIA.join(', ')}.`);

  const enabled = slide.enabled !== false;

  // Length guards run against the VISIBLE text, so the <em> tag itself never
  // counts toward the width the layout was built for.
  const check = (field: keyof typeof HERO_LIMITS, value: string | undefined) => {
    const text = field === 'headline' ? headlineVisibleText(value ?? '') : (value ?? '');
    if (text.length > HERO_LIMITS[field]) add(field, `${field} is ${text.length} characters; the layout holds ${HERO_LIMITS[field]}.`);
  };
  check('kicker', slide.kicker);
  check('headline', slide.headline);
  check('subcopy', slide.subcopy);
  check('ctaLabel', slide.ctaLabel);
  check('finePrint', slide.finePrint);
  check('imageAlt', slide.imageAlt);

  if (slide.headline && !emBalanced(slide.headline)) {
    add('headline', 'Every <em> needs a matching </em>, or the green accent runs into the rest of the line.');
  }

  if (enabled) {
    if (!slide.headline || headlineVisibleText(slide.headline).trim().length === 0) {
      add('headline', 'An enabled slide needs a headline.');
    }
    // A dead CTA is hidden at render (§2.5); flag it here so the operator knows why.
    const url = (slide.ctaUrl ?? '').trim();
    if (url && (url === '#' || (!url.startsWith('/') && !/^https?:\/\//i.test(url)))) {
      add('ctaUrl', 'The link must be a real path (starts with /) or a full URL. "#" is not a link.');
    }
    // A bleed slide with no photo is a black rectangle.
    if (slide.media === 'bleed' && !(slide.imageUrl ?? '').trim()) {
      add('imageUrl', 'A full-bleed slide needs a background photograph.');
    }
    if ((slide.imageUrl ?? '').trim() && !(slide.imageAlt ?? '').trim()) {
      add('imageAlt', 'An image needs alt text — for the customer using a screen reader, and for search.');
    }
  }

  return errors;
};

/** Is this flash slide advertising a sale that has already ended? (§2.5 editor flag) */
export const flashSaleHasEnded = (extras: Record<string, unknown> | undefined, now = Date.now()): boolean => {
  const iso = extras && typeof extras.saleEndsIso === 'string' ? extras.saleEndsIso : null;
  if (!iso) return false;
  const end = new Date(iso).getTime();
  return Number.isFinite(end) && end <= now;
};
