import { flashSaleHasEnded } from '../hero/validation';
import type { NavConfig } from './types';

/**
 * §9 guard rails: a CMS that lets someone break the header is worse than code.
 * Character limits are the widths the layout was built around; hrefs must be real;
 * alts must exist; the header can never have zero categories. Copy rendered with
 * set:html is passed through sanitiseNavHtml (the <em>/<b> boundary is the XSS
 * boundary) both here and again at the render sink.
 */

export const NAV_LIMITS = {
  categoryLabel: 14,
  tileDescriptor: 44,
  chipLabel: 12,
  featuredName: 40,
  featuredLine: 60,
  finderNote: 60,
} as const;

export interface NavConfigError { path: string; message: string; }

/** Visible length: strip the only allowed inline tags so a tag never counts as width. */
export function navVisibleText(v: string): string {
  return (v ?? '').replace(/<\/?(?:em|b)>/gi, '');
}

/**
 * Escape EVERYTHING, then restore ONLY bare <em>/</em> and <b>/</b>. A <script>,
 * an <em onmouseover>, an <img onerror> all become inert text. Mirrors the hero's
 * sanitiseHeadline, extended to the two tags the nav copy uses.
 */
export function sanitiseNavHtml(v: string): string {
  const escaped = (v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return escaped
    .replace(/&lt;em&gt;/gi, '<em>')
    .replace(/&lt;\/em&gt;/gi, '</em>')
    .replace(/&lt;b&gt;/gi, '<b>')
    .replace(/&lt;\/b&gt;/gi, '</b>');
}

const isRealHref = (h: unknown): boolean =>
  typeof h === 'string' && h.trim() !== '' && h !== '#' && (h.startsWith('/') || /^https?:\/\//i.test(h) || h.startsWith('tel:'));

const balancedTags = (v: string): boolean => {
  for (const tag of ['em', 'b']) {
    const open = (v.match(new RegExp(`<${tag}>`, 'gi')) || []).length;
    const close = (v.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
    if (open !== close) return false;
  }
  return true;
};

/** Returns [] when the config is safe to store and render; otherwise every problem. */
export function validateNavConfig(cfg: NavConfig): NavConfigError[] {
  const errs: NavConfigError[] = [];
  const push = (path: string, message: string) => errs.push({ path, message });
  if (!cfg || typeof cfg !== 'object') return [{ path: 'config', message: 'The header configuration is missing.' }];

  // 1. never zero categories
  if (!Array.isArray(cfg.rail) || cfg.rail.length < 1) {
    push('rail', 'The header needs at least one category.');
  } else {
    cfg.rail.forEach((r, i) => {
      if (navVisibleText(r.label).length > NAV_LIMITS.categoryLabel) push(`rail[${i}].label`, `Category name over ${NAV_LIMITS.categoryLabel} characters — it will overflow.`);
      if (!isRealHref(r.href)) push(`rail[${i}].href`, 'Category link must be a real page (starts with /), not empty or #.');
    });
  }

  // panels: tiles, list rows, capacity caps, finder chips + note, featured cards
  (cfg.panels ?? []).forEach((p) => {
    const at = `panels.${p.key}`;
    (p.tiles ?? []).forEach((t, i) => {
      if (!isRealHref(t.href)) push(`${at}.tiles[${i}].href`, 'Tile link must be a real page.');
      if (navVisibleText(t.descriptor).length > NAV_LIMITS.tileDescriptor) push(`${at}.tiles[${i}].descriptor`, `Tile description over ${NAV_LIMITS.tileDescriptor} characters.`);
    });
    (p.listRows ?? []).forEach((r, i) => { if (!isRealHref(r.href)) push(`${at}.listRows[${i}].href`, 'Link must be a real page.'); });
    (p.capacityMatrix ?? []).forEach((row, ri) => {
      if (!isRealHref(row.allSizes.href)) push(`${at}.capacityMatrix[${ri}].allSizes`, 'Link must be a real page.');
      row.caps.forEach((c, ci) => { if (!isRealHref(c.href)) push(`${at}.capacityMatrix[${ri}].caps[${ci}]`, 'Link must be a real page.'); });
    });
    if (p.batteryFinder) {
      if (navVisibleText(p.batteryFinder.note).length > NAV_LIMITS.finderNote) push(`${at}.batteryFinder.note`, `Finder note over ${NAV_LIMITS.finderNote} characters.`);
      if (!isRealHref(p.batteryFinder.formAction)) push(`${at}.batteryFinder.formAction`, 'Finder action must be a real page.');
      p.batteryFinder.brandChips.forEach((c, i) => {
        if (navVisibleText(c.label).length > NAV_LIMITS.chipLabel) push(`${at}.batteryFinder.brandChips[${i}].label`, `Chip label over ${NAV_LIMITS.chipLabel} characters.`);
        if (!isRealHref(c.href)) push(`${at}.batteryFinder.brandChips[${i}].href`, 'Chip link must be a real page.');
      });
      if (!isRealHref(p.batteryFinder.askAction.href)) push(`${at}.batteryFinder.askAction.href`, 'The WhatsApp escape link must be real.');
    }
    if (p.featColumn) p.featColumn.rows.forEach((r, i) => { if (!isRealHref(r.href)) push(`${at}.featColumn.rows[${i}].href`, 'Link must be a real page.'); });
    if (p.featured) validateFeatured(p.featured, at, push);
  });

  // flash panel
  if (cfg.flash) {
    if (!isRealHref(cfg.flash.cta.href)) push('flash.cta.href', 'The flash CTA link must be real.');
    cfg.flash.discountRows.forEach((r, i) => { if (!isRealHref(r.href)) push(`flash.discountRows[${i}].href`, 'Link must be a real page.'); });
    validateFeatured(cfg.flash.featured, 'flash', push);
    if (cfg.settings?.saleEndsIso && flashSaleHasEnded({ saleEndsIso: cfg.settings.saleEndsIso })) {
      push('settings.saleEndsIso', 'This flash-sale deadline has already passed — the sale is not being shown.');
    }
  }

  // XSS-boundary strings: balanced tags only (the sanitiser strips the rest at render)
  const htmlFields: Array<[string, string | undefined]> = [
    ['search.zeroResultCopy', cfg.search?.zeroResultCopy],
    ['miniCart.cutoffSunday', cfg.miniCart?.cutoffSunday],
    ['miniCart.cutoffAfter', cfg.miniCart?.cutoffAfter],
    ['miniCart.cutoffBefore', cfg.miniCart?.cutoffBefore],
    ['popover.signedIn.subTemplate', cfg.popover?.signedIn?.subTemplate],
    ['popover.returning.mobileSub', cfg.popover?.returning?.mobileSub],
    ['popover.firstTime.holdSub', cfg.popover?.firstTime?.holdSub],
    ['popover.firstTime.mobileSub', cfg.popover?.firstTime?.mobileSub],
  ];
  htmlFields.forEach(([path, v]) => { if (v != null && !balancedTags(v)) push(path, 'Unbalanced <em>/<b> tag — close every tag you open.'); });

  return errs;
}

function validateFeatured(f: NavConfig['flash']['featured'], at: string, push: (p: string, m: string) => void): void {
  if (!isRealHref(f.href)) push(`${at}.featured.href`, 'Featured link must be a real page.');
  if (f.img && (!f.alt || !f.alt.trim())) push(`${at}.featured.alt`, 'A featured image must have alt text (for screen readers and Google).');
  if (navVisibleText(f.name).length > NAV_LIMITS.featuredName) push(`${at}.featured.name`, `Featured name over ${NAV_LIMITS.featuredName} characters.`);
  if (navVisibleText(f.line).length > NAV_LIMITS.featuredLine) push(`${at}.featured.line`, `Featured line over ${NAV_LIMITS.featuredLine} characters.`);
}
