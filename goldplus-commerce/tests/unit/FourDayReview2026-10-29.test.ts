import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trailingSlashTarget } from '../../apps/web/src/lib/pageAddress';
import { policyBySlug } from '../../apps/web/src/lib/legal-policies';
import { RETURNS_POLICY } from '../../apps/web/src/lib/returnsPolicy';

/**
 * Review of everything shipped 2026-10-24 → 2026-10-28 (PRs #177–#190) and the
 * loose ends found alongside it. One block per fix, so a regression names the
 * finding it reopened.
 */
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('one address per page', () => {
  it('a slashed page address goes to the bare one, query kept', () => {
    expect(trailingSlashTarget('GET', '/shop/', '?category=power')).toBe('/shop?category=power');
    expect(trailingSlashTarget('GET', '/phone-batteries/tecno-spark-7-kf6n/')).toBe('/phone-batteries/tecno-spark-7-kf6n');
    expect(trailingSlashTarget('HEAD', '/products/bl-49ft-battery//')).toBe('/products/bl-49ft-battery');
    expect(trailingSlashTarget('GET', '//')).toBe('/');
  });
  it('leaves the root, bare addresses, writes, relays, assets and machine endpoints alone', () => {
    expect(trailingSlashTarget('GET', '/')).toBeNull();
    expect(trailingSlashTarget('GET', '/shop')).toBeNull();
    expect(trailingSlashTarget('POST', '/cart/')).toBeNull();
    expect(trailingSlashTarget('GET', '/api/battery-finder/event/')).toBeNull();
    expect(trailingSlashTarget('GET', '/_astro/chunk/')).toBeNull();
    expect(trailingSlashTarget('GET', '/.well-known/mcp/')).toBeNull();
  });
  it('the middleware applies it after the moved-pages rule (one hop, not two)', () => {
    const mw = read('apps/web/src/middleware.ts');
    const moved = mw.indexOf('const moved = MOVED_PATHS[');
    const slash = mw.indexOf('trailingSlashTarget(context.request.method');
    expect(moved).toBeGreaterThan(0);
    expect(slash).toBeGreaterThan(moved);
    expect(mw).not.toMatch(/\^\\\/products\\\/\[\^\/\]\+\\\/\+\$/); // the old product-only rule is gone
  });
});

describe('error pages are not pages', () => {
  it('404 and 500 declare themselves error pages: no canonical, no og:url, noindex', () => {
    for (const f of ['apps/web/src/pages/404.astro', 'apps/web/src/pages/500.astro']) expect(read(f), f).toMatch(/<BaseLayout [^>]*\berrorPage>/);
    const layout = read('apps/web/src/layouts/BaseLayout.astro');
    expect(layout).toContain('{!errorPage && <link rel="canonical" href={canonical} />}');
    expect(layout).toContain('{!errorPage && <meta property="og:url" content={canonical} />}');
    expect(layout).toContain("const robotsMeta = robotsMetaProp ?? (errorPage ? 'noindex,follow' : undefined);");
  });
});

describe('the returns page says what the policy is', () => {
  it('its search description states the window, the condition and the faulty promise from the one returns fact', () => {
    const summary = policyBySlug('returns')!.summary;
    expect(summary).toContain(`within ${RETURNS_POLICY.windowDays} days`);
    expect(summary).toMatch(/unused and complete/);
    expect(summary).toMatch(/replace or refund/);
    expect(summary.length).toBeGreaterThanOrEqual(110);
    expect(summary.length).toBeLessThanOrEqual(160);
  });
});

describe('Clarity never records a name, a chat or a secret address', () => {
  it("Goldie's panel and the account greeting are masked on every page, catalogue pages included", () => {
    expect(read('apps/web/src/components/ShopAssistant.astro')).toMatch(/<div id="gp-assistant" class="gp-assistant" data-clarity-mask="true"/);
    const nav = read('apps/web/src/components/GpNav.astro');
    expect(nav).toContain('<div class="gp-nav__acct" id="gpNavAcct" data-clarity-mask="true">');
    expect(nav).toMatch(/id="gpNavPtsWrap" hidden="" data-clarity-mask="true"/);
  });
  it('a visit whose address carries a fragment (other than our share token) or a redacted parameter is not recorded', () => {
    const layout = read('apps/web/src/layouts/BaseLayout.astro');
    expect(layout).toContain("var secret = location.hash.length > 1 && !new RegExp(share).test(location.hash), rx = new RegExp(red, 'i');");
    expect(layout).toContain('if (secret) return;');
    expect(layout).toMatch(/red: arrivalRules\.red, share: arrivalRules\.share\.frag/);
  });
});

describe('review photos from a phone camera', () => {
  it('are shrunk in the browser before upload, and refusals speak about reviews, not cards', async () => {
    const page = read('apps/web/src/pages/review.astro');
    expect(page).toContain('data-review-photos');
    expect(page).toMatch(/const MAX_SIDE = 1600;/);
    expect(page).toContain("canvas.toBlob(r, 'image/jpeg', 0.85)");
    const { REVIEW_PHOTO_REFUSAL_WORDS } = await import('../../apps/api/src/application/use-cases/reviews/ReviewPhotoUseCases');
    for (const w of Object.values(REVIEW_PHOTO_REFUSAL_WORDS)) expect(w).not.toMatch(/card/i);
  });
});

describe('published copy says only what the shop does', () => {
  const dir = resolve(__dirname, '../../docs/content/guides');
  const guides = readdirSync(dir).filter((n) => /^\d+-.*\.md$/.test(n)).map((n) => [n, readFileSync(resolve(dir, n), 'utf8')] as const);
  it('no guide or menu note claims every unit is tested (owner decision 2026-10-13)', () => {
    const claim = /written full and read back|tested full|tests every card|every (card|unit) is tested/i;
    for (const [n, t] of guides) expect(t, n).not.toMatch(claim);
    expect(read('packages/shared/src/nav/config.ts')).not.toMatch(claim);
    expect(read('apps/web/src/components/GpNav.astro')).not.toMatch(claim);
  });
  it('no guide promises an unconditional fit check, an arrival time, or anonymity the forms do not give', () => {
    for (const [n, t] of guides) {
      expect(t, n).not.toMatch(/(^|[.!] )We confirm the fit before you pay\./m);   // a promise; asking first is the offer
      expect(t, n).not.toMatch(/we deliver in Kampala and Wakiso the same day|same-day delivery in Kampala and Wakiso for orders/i);
      expect(t, n).not.toMatch(/never who you are|not who you are/i);
    }
    expect(read('apps/web/src/pages/verification/index.astro')).not.toMatch(/never who you are/);
  });
  it('GP-C08 is described by its listed outputs (5V⎓2A, 9V⎓1A: at most 10W), never as 12W', () => {
    for (const [n, t] of guides) expect(t, n).not.toMatch(/GP-C08[^\n]{0,160}12W|12W[^\n]{0,80}GP-C08/);
  });
});

describe('measurement jobs that heal instead of wedging or drifting', () => {
  it('the nightly takes its run record inside the try (a failed insert used to hold the lock until a restart)', () => {
    const t = read('apps/api/src/infrastructure/scheduler/MeasurementNightlyTicker.ts');
    expect(t).toMatch(/let runId: string \| undefined;[\s\S]{0,400}try \{\s*runId = rows\(await db\.execute\(sql`insert into measurement\.batch_run/);
  });
  it('the 1 pm rates run once a day across the cluster, and only a success marks the day done', () => {
    const t = read('apps/api/src/infrastructure/scheduler/MeasurementNightlyTicker.ts');
    expect(t).toContain("const lock = await tryAcquireSessionLock(BOU_LOCK_ID);");
    expect(t).toMatch(/\$\{ok \? 'COMPLETE' : 'FAILED'\}/);
    expect(t).not.toContain('bouRanOn = day;');
  });
  it('fixed agreements (placements, creator fees) are costed over the whole modelling window under their own tag', () => {
    const t = read('apps/api/src/infrastructure/measurement/MarketingCostDerivation.ts');
    expect(t).toContain("export const AGREEMENTS_SOURCE = 'derived_agreements';");
    expect(t).toMatch(/source = \$\{AGREEMENTS_SOURCE\} or \(source = \$\{DERIVED_SOURCE\} and \(channel in \('youtube', 'offline_media'\)/);
  });
  it('the scheduled BoU browser workflow stays off until the owner turns it on', () => {
    expect(read('../.github/workflows/bou-fx.yml')).toContain("if: ${{ github.event_name != 'schedule' || vars.BOU_FX_ENABLED == 'true' }}");
  });
});

describe('loose ends of #187, #189 and #190 (2026-10-29)', () => {
  it('the returns page offers "Start a return online" whichever policy wording is live', () => {
    const page = read('apps/web/src/pages/returns.astro');
    const afterSwitch = page.slice(page.indexOf('</>}'));
    expect(afterSwitch).toContain('href="/returns/start"');
    expect(afterSwitch).toContain('Start a return online');
  });
  it('the bare parent addresses move permanently, kept by a browser for a day only; dealers find their page', () => {
    for (const [p, target] of [['dealers', '/dealers/apply'], ['delivery', '/delivery/kampala-wakiso'], ['locations', '/locations/zainab-aziza']]) {
      expect(read(`apps/web/src/pages/${p}/index.astro`)).toContain(`status: 301, headers: { Location: '${target}', 'Cache-Control': 'public, max-age=86400' }`);
    }
    expect(read('apps/web/src/pages/dealers/apply.astro')).toContain('href="/dealers/dashboard"');
  });
  it('finder settings name the supplier-listed note and the index threshold for what they now are', () => {
    const page = read('apps/web/src/pages/admin/batteries/finder-settings.astro');
    expect(page).not.toContain('Note on an unchecked fit');
    expect(page).toContain('Note on a supplier-listed fit');
    expect(page).toContain('Public fits before /battery-finder is indexed');
    expect(page).toContain('const STALE_FIT_WORDS');
  });
  it('a phone page answers a recorded redirect before it gives up with a 404', () => {
    const page = read('apps/web/src/pages/phone-batteries/[device].astro');
    expect(page).toContain('const recorded = await findRecordedRedirect(Astro.url.pathname);');
    expect(page).toContain("if (!isDeviceSlug(slug)) return notFound();");
    expect(page).toContain('if (!deviceRes.ok && deviceRes.status === 404) return notFound();');
  });
});

