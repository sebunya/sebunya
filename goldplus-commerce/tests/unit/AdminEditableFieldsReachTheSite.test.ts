import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * An admin field that the storefront ignores is worse than a missing one.
 *
 * /admin/nav happily accepted a new phone number, reported success, bumped the
 * config version — and the header kept rendering a number hard-coded in eight
 * places. The operator has no way to see that their edit did nothing.
 *
 * These contracts pin the two halves of that:
 *   1. the header reads contact details from business_info, the ONE owner;
 *   2. nothing re-introduces a hard-coded phone number or WhatsApp link.
 */

const ROOT = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Comments describe the bug; they must not satisfy the assertions. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*\*.*$/gm, '');

const NAV = 'apps/web/src/components/GpNav.astro';
const ADMIN_NAV = 'apps/web/src/pages/admin/nav.astro';

describe('the header renders contact details from the admin, not from source', () => {
  it('reads business_info rather than hard-coding the number', () => {
    const src = code(NAV);
    expect(src).toContain('getBusinessInfo');
    expect(src).toMatch(/biz\.phoneDisplay/);
    expect(src).toMatch(/biz\.phoneDial/);
    expect(src).toMatch(/biz\.whatsappUrl/);
  });

  it('has no literal phone number or WhatsApp link left anywhere in the header', () => {
    const src = code(NAV);
    // The specific live values, and the shapes generally — a different number
    // hard-coded tomorrow is the same defect.
    expect(src).not.toMatch(/0705\s*004545/);
    expect(src).not.toMatch(/wa\.me\/\d/);
    expect(src).not.toMatch(/tel:\+?\d/);
  });

  it('gives the client-side search footer the configured WhatsApp URL', () => {
    // Built as a string in the browser, so it needs the value injected — this
    // was the one link the server-side sweep could not reach.
    const src = code(NAV);
    expect(src).toMatch(/whatsappUrl:\s*biz\.whatsappUrl/);
    expect(src).toMatch(/CFG\.whatsappUrl/);
  });
});

describe('every nav field the admin edits is actually rendered', () => {
  const src = code(NAV);

  it('renders the search placeholders the admin sets', () => {
    expect(src).toContain('nav.search.placeholderDesktop');
    expect(src).toContain('nav.search.placeholderMobile');
  });

  it('renders the flash CTA and note the admin sets', () => {
    expect(src).toContain('nav.flash.cta.label');
    expect(src).toContain('nav.flash.cta.href');
    expect(src).toContain('nav.flash.noteDefault');
  });

  it('leaves no editable scalar in the admin form that the header never reads', () => {
    // The admin's own list of writable dotted paths is the spec. Every one of
    // them must appear in the header, or the form is lying about its effect.
    const admin = code(ADMIN_NAV);
    const listed = [...admin.matchAll(/'((?:settings|search|flash)\.[a-zA-Z.]+)'/g)].map((m) => m[1]);
    expect(listed.length).toBeGreaterThan(5);

    const unread = listed.filter((path) => !src.includes(`nav.${path}`));
    // `flash.stock.*` and the alternate note are knowingly excluded below.
    const KNOWN_UNWIRED = new Set([
      'flash.stock.left', 'flash.stock.of', 'flash.stock.barWidthPct', 'flash.stock.label',
      'flash.noteFinalHours', 'settings.cutoffTimeLabel', 'settings.pointsToUgxRate',
    ]);
    expect(unread.filter((p) => !KNOWN_UNWIRED.has(p))).toEqual([]);
  });
});

describe('contact has exactly one editor', () => {
  it('/admin/nav no longer writes contact fields', () => {
    const admin = code(ADMIN_NAV);
    expect(admin).not.toMatch(/'contact\.[a-zA-Z]+'/);
    expect(admin).not.toMatch(/cfg\.contact\./);
  });

  it('/admin/nav points the operator at the owner instead', () => {
    expect(read(ADMIN_NAV)).toContain('/admin/business-info');
  });

  it('/admin/business-info still edits the full contact document', () => {
    const biz = code('apps/web/src/pages/admin/business-info.astro');
    for (const field of ['phoneDisplay', 'phoneDial', 'whatsappNumber', 'whatsappUrl']) {
      expect(biz).toContain(field);
    }
  });
});
