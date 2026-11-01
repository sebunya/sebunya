import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_NAV_CONFIG } from '@goldplus/shared';

/**
 * CLAUDE.md: "NO invented product facts, fake reviews, fake ratings, or fake
 * scarcity" and "Ethical behavioural economics only. Do not use dark patterns
 * or fake urgency."
 *
 * The header broke all of that at once. It rendered a stock meter reading
 * "14 left of 60 at this price" behind a hard-coded 23% bar; per-category cuts
 * of −40%/−35%/−30%/−25% for a sale that had no items and no row; "80+ models
 * in stock" against a catalogue of 8 products and an EMPTY device table; and a
 * "Live" flash-sale chip over a countdown whose deadline had already passed.
 *
 * None of it was operator error — it was all in the source and the seed. These
 * contracts keep it out.
 */

const ROOT = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Comments explain the removed claims; they must not satisfy the assertions. */
const code = (p: string) =>
  read(p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const NAV = code('apps/web/src/components/GpNav.astro');

describe('the header states no scarcity it cannot source', () => {
  it('has no hard-coded "N left of M" meter', () => {
    expect(NAV).not.toMatch(/\d+\s*left/i);
    expect(NAV).not.toMatch(/gp-nav__stock-bar/);
    expect(NAV).not.toMatch(/at this price/i);
  });

  it('has no invented catalogue-size claim', () => {
    // "80+ models in stock" — devices, product_device_compatibility and
    // product_compatibility_mappings are all empty.
    expect(NAV).not.toMatch(/\d+\+\s*(models|SKUs|products)/i);
  });

  it('quotes no per-category discount the pricing engine did not produce', () => {
    // A literal −40% in the template is a number nobody can honour. Matches
    // the typographic minus the discount rows used; a plain hyphen would also
    // hit CSS like translateY(-50%), which is not a claim about anything.
    expect(NAV).not.toMatch(/−\s*\d{1,2}\s*%/);
  });

  it('derives the one advertised percentage from the running campaign', () => {
    expect(NAV).toMatch(/navDeal\.percent/);
  });
});

describe('sale furniture appears only while a sale is really running', () => {
  it('takes the deadline from the campaign, not a hand-typed date', () => {
    // saleEndsIso was 2026-08-09 while the header still said "Live".
    expect(NAV).toMatch(/const saleEnds = navDeal\.active/);
    expect(NAV).not.toMatch(/nav\.settings\?\.saleEndsIso/);
  });

  it('gates the panel, the rail chip and both mobile entries on saleLive', () => {
    expect(NAV).toMatch(/\{saleLive && \(\s*\n?\s*<div class="gp-nav__panel" data-panel="flash">/);
    expect(NAV).toMatch(/railItems = saleLive \? nav\.rail : nav\.rail\.filter/);
    expect(NAV).toMatch(/\{saleLive && <a href=\{nav\.flash\.cta\.href\}>Flash sale/);
    expect(NAV).toMatch(/\{saleLive && \(\s*\n?\s*<a class="gp-nav__mflash"/);
  });

  it('renders the rail from the filtered list, never the raw config', () => {
    expect(NAV).toContain('railItems.map');
    expect(NAV).not.toContain('nav.rail.map');
  });
});

describe('the config offers no field for inventing scarcity', () => {
  it('has no stock meter or discount rows to type numbers into', () => {
    const flash = DEFAULT_NAV_CONFIG.flash as Record<string, unknown>;
    expect(flash.stock).toBeUndefined();
    expect(flash.discountRows).toBeUndefined();
    expect(flash.discountRowsHeading).toBeUndefined();
  });

  it('the admin form cannot write them either', () => {
    const admin = code('apps/web/src/pages/admin/nav.astro');
    expect(admin).not.toMatch(/flash\.stock/);
    expect(admin).not.toMatch(/discountRows/);
  });

  it('the shipped defaults contain no fabricated figures', () => {
    const seed = JSON.stringify(DEFAULT_NAV_CONFIG);
    expect(seed).not.toMatch(/−\d{2}%/);
    expect(seed).not.toMatch(/\d+\+ (models|SKUs)/i);
  });
});
