import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeNbaCandidates, type NbaContext, type ProductPublicDto } from '@goldplus/shared';
import { buildHomepageProductAllocation } from '../../apps/web/src/lib/homepage-merchandising';

/**
 * Owner decisions of 2026-09-24 and round 2 of the storefront jury, for the
 * shop window: home, header, shop listing, product card and product page.
 *  2. honest highlight labels, no live dot, photographed products only;
 *  3. the header's join wording matches reality (email sign-in);
 *  4. no numeric stock count anywhere, the in/out-of-stock state stays;
 *  6. sticky header on phones, two compact cards per row on phone listings.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const WEB = 'apps/web/src/';

const SAMPLE_ALT = 'Sample image (no photo of this product yet) — GoldPlus Battery';

function product(id: string, photographed: boolean): ProductPublicDto {
  const url = `/uploads/assets/${id}/pdp.webp`;
  return {
    id,
    slug: id,
    name: `Product ${id}`,
    categoryName: 'Power Devices',
    shortDescription: null,
    longDescription: null,
    sku: null,
    modelNumber: null,
    retailPriceUgx: 150_000,
    floorPriceUgx: null,
    availability: { kind: 'in_stock', quantity: 200 },
    hasImage: true,
    primaryImageUrl: url,
    verifiedSpecs: {},
    hasMissingSpecs: false,
    images: [{ url, alt: photographed ? `Product ${id} on white` : SAMPLE_ALT }],
    attributeValues: [],
  };
}

describe('decision 2: the two home highlight cards', () => {
  const card = read(`${WEB}components/HomeCommerceHighlights.astro`);

  it('claim nothing they cannot back: no "Verified", no "Today\'s", no pulsing dot', () => {
    expect(card).not.toMatch(/Verified GoldPlus Pick|Today's GoldPlus Pick|Explore pick/);
    expect(card).not.toContain('animate-pulse');
    expect(card).not.toMatch(/verified before you buy|Selected product worth/i);
    expect(card).toContain('From the GoldPlus range');
    expect(card).toContain('Also in the range');
  });

  it('are photographed products, not the 5th and 6th catalogue items', () => {
    // Catalogue order: four photographed, two sample frames, then two more photographed.
    const catalogue = [
      product('p1', true), product('p2', true), product('p3', true), product('p4', true),
      product('s5', false), product('s6', false),
      product('p7', true), product('p8', true),
    ];
    const a = buildHomepageProductAllocation(catalogue);
    expect(a.promoProduct?.id).toBe('p7');
    expect(a.todaysPickProduct?.id).toBe('p8');
  });

  it('are hidden, not filled with a sample frame, when no photographed product is left', () => {
    const catalogue = [
      product('p1', true), product('p2', true), product('p3', true), product('p4', true),
      product('s5', false), product('s6', false),
    ];
    const a = buildHomepageProductAllocation(catalogue);
    expect(a.promoProduct).toBeNull();
    expect(a.todaysPickProduct).toBeNull();
    expect(a.hiddenSections.promo).toBe(true);
    expect(a.hiddenSections.todaysPick).toBe(true);
  });
});

describe('decision 3 + round 2: the header says what is true', () => {
  const nav = read(`${WEB}components/GpNav.astro`);

  it('never says the phone number is the account; sign-in is by email', () => {
    expect(nav).not.toMatch(/'[^'\n]*number is (?:your|the) account[^'\n]*'/i);
    expect(nav).not.toContain('Nothing else to fill in');
    expect(nav).toContain('Next, an email and a password. You sign in with your email.');
    expect(nav).toContain('Join free with your phone, an email and a password.');
  });

  it('points are earned on delivered orders, not paid ones', () => {
    expect(nav).not.toMatch(/every paid order/);
    expect(nav).toContain('on every delivered order');
  });

  it('every same-day line is scoped to Kampala & Wakiso', () => {
    expect(nav).not.toMatch(/and it arrives today|Check out now and we deliver today|we deliver <b>today<\/b>/);
    expect(nav).toContain("var SD = 'Kampala & Wakiso: ';");
    expect(nav).toContain("'Kampala &amp; Wakiso: check out in <b>' + left + '</b> for <b>same-day</b> delivery.'");
  });

  it('phone drawer fields are 16px, so iOS does not zoom the page on focus', () => {
    expect(nav).toMatch(/\.gp-nav__msearch input\{[^}]*font:400 16px/);
    expect(nav).toMatch(/\.gp-nav__mjoin input\{[^}]*font:400 16px/);
    expect(nav).not.toMatch(/font:400 15px/);
  });

  it('a rail link with a panel tells assistive tech how to open it', () => {
    expect(nav).toContain('<span id="gpNavHint" hidden>Down arrow opens more links</span>');
    expect(nav).toContain("el.setAttribute('aria-describedby','gpNavHint')");
  });

  it('ships no HTML comments (they reach every visitor on every page)', () => {
    const markup = nav.slice(nav.indexOf('\n---', 4) + 4, nav.indexOf('<style is:global>'));
    expect(markup).not.toContain('<!--');
  });
});

describe('decision 3 + round 2: the server NBA list and the admin nav defaults say the same', () => {
  // GpNav renders window.GP_NBA from computeNbaCandidates, and that list wins
  // over GpNav's own fallback list: scanning GpNav alone missed this once.
  const nba = read('packages/shared/src/nav/nba.ts');
  const config = read('packages/shared/src/nav/config.ts');
  const base: NbaContext = {
    signedIn: false, visits: 1, cart: 0, points: 0, lastOrderDays: null, orderInTransit: false,
    beforeCutoff: true, minsToCutoff: 180, sunday: false, saleLive: false,
  };
  const all = (ctx: NbaContext) => computeNbaCandidates(ctx);
  const byId = (ctx: NbaContext, id: string) => all(ctx).find((x) => x.id === id)!;

  it('neither source says the phone number is the account, or that points come with payment', () => {
    for (const [f, src] of [['nba.ts', nba], ['config.ts', config]] as const) {
      expect(src, f).not.toMatch(/number is (?:your|the) account/i);
      expect(src, f).not.toContain('Nothing else to fill in');
      expect(src, f).not.toMatch(/every paid order/);
    }
  });

  it('the join copy promises points on delivered orders', () => {
    expect(byId({ ...base, visits: 1 }, 'welcome').text).toBe('Join free and earn <em>points</em> on every delivered order');
    expect(byId({ ...base, visits: 3 }, 'signup').text).toBe('Join free, and points start with your next delivered order');
  });

  it('every same-day line from the server list names Kampala & Wakiso', () => {
    const soon = byId({ ...base, minsToCutoff: 42 }, 'cutoff');
    expect(soon.text).toBe('Kampala & Wakiso: only <em>42 minutes</em> left to order for delivery today');
    expect(soon.short).toBe('Kampala & Wakiso: <em>42 min</em> left for same-day');
    const later = byId({ ...base, cutoffLabel: '5:00pm' }, 'cutoff');
    expect(later.text).toContain('in Kampala and Wakiso');
    expect(later.short).toBe('Kampala & Wakiso: order by <b>5:00pm</b> for same-day');
    for (const mins of [42, 185]) {
      const cart = byId({ ...base, cart: 1, minsToCutoff: mins }, 'cart-cutoff');
      expect(cart.text.startsWith('Kampala & Wakiso: ')).toBe(true);
      expect(cart.short!.startsWith('Kampala & Wakiso: ')).toBe(true);
    }
    expect(nba).not.toMatch(/and it arrives today|Check out now and we deliver today|, arrives today/);
  });

  it('past the cutoff the promise is when it goes out, not when it arrives', () => {
    expect(byId({ ...base, beforeCutoff: false }, 'aftercutoff').text)
      .toBe("Today's run has left. Order now and it goes out <b>tomorrow morning</b>");
    expect(byId({ ...base, beforeCutoff: false, cart: 1 }, 'cart-later').text).toContain('it goes out <b>tomorrow morning</b>');
  });

  it('the admin-editable first-time panel defaults match email sign-in', () => {
    expect(config).toContain("joinNote: 'Next, an email and a password. You sign in with your email.',");
    expect(config).toContain("mobileSub: '<b>Up to {discountPct}% off</b> right now. It comes off at checkout.',");
  });
});

describe('decision 6: the header stays on phones without covering focus', () => {
  const nav = read(`${WEB}components/GpNav.astro`);
  const phone = nav.slice(nav.indexOf('@media (max-width:980px){'));

  it('is sticky only in the phone layout, with the strip above it scrolling away', () => {
    expect(phone).toContain('.gp-nav{position:sticky;top:calc(0px - var(--gpn-stick,34px));}');
    expect(nav.slice(0, nav.indexOf('@media (max-width:980px){'))).not.toMatch(/\.gp-nav\{[^}]*position:sticky/);
    expect(nav).toContain("nav.style.setProperty('--gpn-stick', bar.offsetTop + 'px');");
  });

  it('keeps focused fields and #anchors clear of the bar (WCAG 2.4.11), and never animates itself', () => {
    expect(phone).toContain('html{scroll-padding-top:72px;}');
    expect(phone).not.toMatch(/\.gp-nav\{[^}]*(?:transition|animation)/);
  });
});

describe('decision 6: two compact cards per row on phone listings', () => {
  const shop = read(`${WEB}pages/shop.astro`);
  const card = read(`${WEB}components/ProductCard.astro`);

  it('the shop results and its fallback grid are two columns from the smallest phone', () => {
    expect(shop).toContain('aria-label="Product results" class="mt-6 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4"');
    expect(shop).toContain('class="mt-5 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3"');
    expect(shop).not.toMatch(/grid grid-cols-1 gap-5 sm:grid-cols-2/);
  });

  it('the category hub product grid (/<hub>/<child>) is two columns from the smallest phone', () => {
    const child = read(`${WEB}pages/[hub]/[...child].astro`);
    expect(child).toContain('<div class="mt-5 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">');
    expect(child).not.toContain('grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4');
  });

  it('the two-column rail cards are compact on phones and set nothing below 11px', () => {
    const rv = read(`${WEB}components/recommendations/RecentlyViewedRail.astro`);
    expect(rv).not.toMatch(/text-\[(?:[0-9]|10)px\]/);
    expect(rv).toContain('rounded-2xl p-3 sm:p-5 hover:');
    expect(rv).not.toContain('rounded-2xl p-5 ');
    const rec = read(`${WEB}components/recommendations/RecommendationCard.astro`);
    expect(rec).toContain('rounded-2xl p-3 sm:p-5 hover:');
    expect(rec).not.toContain('rounded-2xl p-5 ');
  });

  it('the card is compact on phones but keeps 44px actions and legible type', () => {
    expect(card).toContain('rounded-2xl p-3 sm:p-5');
    const buttons = card.match(/<button[\s\S]*?>/g) ?? [];
    expect(buttons.length).toBe(2);
    for (const b of buttons) {
      expect(b).toContain('min-h-11');
      expect(b).toContain('whitespace-nowrap');
    }
    expect(card).toContain('class="mt-3 flex flex-wrap gap-2"');
    // nothing on the card is set below 11px
    expect(card).not.toMatch(/text-\[(?:[0-9]|10)px\]/);
    // the rail card's full-size variant follows the same floor (only the cart's
    // compact add-on variant is smaller, and it is not a listing)
    const rec = read(`${WEB}components/recommendations/RecommendationCard.astro`);
    const small = rec.split('\n').filter((l) => /text-\[(?:[0-9]|10)px\]/.test(l));
    for (const line of small) expect(line).toMatch(/^\s*\? /);
  });
});

describe('decision 4: stock is a state, never a number', () => {
  const files = [
    'pages/products/[slug].astro',
    'components/ProductCard.astro',
    'components/recommendations/RecommendationCard.astro',
    'components/recommendations/RecentlyViewedRail.astro',
    'components/HomeCommerceHighlights.astro',
    'components/GpNav.astro',
  ];

  it('no storefront surface in the shop window renders availability.quantity', () => {
    for (const f of files) {
      const src = read(WEB + f);
      expect(src, f).not.toMatch(/availability(?:\?)?\.quantity\s*\}|\$\{[^}]*quantity[^}]*\}\s*(?:available|in stock|left)/);
      expect(src, f).not.toMatch(/left in stock|· \$\{[^}]*\} available/);
    }
  });

  it('the product page keeps the in/out-of-stock badge', () => {
    const pdp = read(`${WEB}pages/products/[slug].astro`);
    expect(pdp).toContain("in_stock: 'In stock',");
    expect(pdp).toContain("out_of_stock: 'Out of stock',");
    expect(pdp).not.toContain('available`}');
  });
});

describe('round 2 deferred items in the shop window', () => {
  it('PDP buy buttons are 48px tall and delivery is quoted only for a product that can be bought', () => {
    const pdp = read(`${WEB}pages/products/[slug].astro`);
    const form = pdp.slice(pdp.indexOf('<form id="pdp-buy"'), pdp.indexOf('</form>', pdp.indexOf('<form id="pdp-buy"')));
    expect((form.match(/min-h-12/g) ?? []).length).toBe(2);
    expect(form).not.toMatch(/\bpy-3\b/);
    expect(pdp).toMatch(/\{canBuy && \(\s*<div class="mb-8">\s*<DeliveryQuote/);
  });

  it('the home Popular rail divides six cards evenly; the shared rail grid is unchanged', () => {
    const rail = read(`${WEB}components/recommendations/RecommendationRail.astro`);
    expect(rail).toContain('gridClass = "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6"');
    expect(rail).toContain('<ul class={gridClass}>');
    const popular = read(`${WEB}components/recommendations/PopularNowRail.astro`);
    expect(popular).toContain('"grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 sm:gap-6"');
    expect(popular).toContain('limit: 6');
  });

  it('an empty /blog is noindex, carries no breadcrumb markup, and offers ways on', () => {
    const blog = read(`${WEB}pages/blog/index.astro`);
    expect(blog).toContain("robotsMeta={empty ? 'noindex,follow' : undefined}");
    expect(blog).toContain('{!empty && <script type="application/ld+json" set:html={breadcrumbs} />}');
    for (const href of ['/product-finder', '/faq', '/shop']) expect(blog).toContain(`href="${href}"`);
  });

  it('product finder has the site-wide page heading', () => {
    const pf = read(`${WEB}pages/product-finder.astro`);
    expect(pf).toContain('<h1 class="text-3xl md:text-4xl font-black tracking-tight text-gray-900 mb-2">Find the right GoldPlus product</h1>');
    expect(pf).toContain('<BaseLayout title="Find the Right GoldPlus Product">');
  });

  it('the shop Search button has no double focus outline; the verification report link is 44px', () => {
    expect(read(`${WEB}pages/shop.astro`)).toMatch(/<button type="submit" class="[^"]*outline-none[^"]*focus-visible:ring-4[^"]*">Search<\/button>/);
    expect(read(`${WEB}pages/verification/index.astro`)).toMatch(/href="\/support\/fake" class="[^"]*min-h-11[^"]*"/);
  });

  it('footer headings step h2 then h3, with no h4 under a missing h3', () => {
    const layout = read(`${WEB}layouts/BaseLayout.astro`);
    const footer = layout.slice(layout.indexOf('<footer'), layout.indexOf('</footer>'));
    expect(footer).toContain('<h2 class="text-white text-base font-black tracking-tight">{whatsappChannel.heading}</h2>');
    expect(footer).toContain('<h3 class="font-bold text-xs uppercase tracking-wider mb-5 text-white">{col.heading}</h3>');
    expect(footer).not.toMatch(/<h4\b/);
  });
});

describe('templates in the shop window compile (tsc does not check .astro markup)', () => {
  // `cond ? ( {/* note */} <el/> )` is two expressions in one parenthesis: it
  // type-checks, then fails Astro's compiler and 500s the page. /shop shipped
  // that way once in this round.
  const files = [
    'pages/shop.astro', 'pages/index.astro', 'pages/products/[slug].astro', 'pages/blog/index.astro',
    'components/ProductCard.astro', 'components/HomeCommerceHighlights.astro', 'components/GpNav.astro',
    'layouts/BaseLayout.astro', 'components/recommendations/PopularNowRail.astro',
  ];
  it('no JSX comment opens a ternary or && branch before its element', () => {
    for (const f of files) {
      expect(read(WEB + f), f).not.toMatch(/(?:\?|&&|:)\s*\(\s*\{\/\*[\s\S]*?\*\/\}\s*</);
    }
  });
});
