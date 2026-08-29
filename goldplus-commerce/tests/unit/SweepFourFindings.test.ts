import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The 2026-08-29 cross-cutting sweep: one source of truth, contradictory
 * config, money and state machines, SSR authorization, and failure paths.
 * One assertion per fix, so a regression names the finding it reopened.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

describe('the page renders what the code defines', () => {
  it('the track-order follow-up calls a function that exists', () => {
    const src = read('apps/web/src/pages/track-order.astro');
    expect(src).not.toMatch(/\$\{label\(order\./);
    expect(src).toMatch(/orderStatusCopy\(order\.orderStatus\)\.label/);
  });

  it('no .astro frontmatter calls an identifier that appears nowhere else in it', () => {
    // .astro frontmatter is NOT typechecked, so a call to something that does
    // not exist ships green and throws at runtime. That is exactly what
    // label() was. The rule here is deliberately narrow and therefore exact:
    // an identifier that is CALLED but occurs only once in the whole
    // frontmatter was never imported and never declared.
    const fs = require('node:fs');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!e.name.endsWith('.astro')) continue;
        const src = fs.readFileSync(p, 'utf8');
        if (!src.startsWith('---')) continue;
        const end = src.indexOf('\n---', 3);
        if (end < 0) continue;
        let c = src.slice(3, end);
        c = c.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
        // Strings too: prose like "photo (optional)" is not a call.
        c = c.replace(/"(\\.|[^"\\])*"/g, '""').replace(/'(\\.|[^'\\])*'/g, "''").replace(/`(\\.|[^`\\])*`/g, '``');
        const KEYWORD = new Set(['if','for','while','switch','catch','return','typeof','await','function','do','else','new','throw','delete','void','yield','import','super','in','of','instanceof','async']);
        for (const m of c.matchAll(/(?<![.\w$])([a-z_$][\w$]*)\s*\(/g)) {
          const name = m[1];
          if (KEYWORD.has(name)) continue;
          // The definition itself is not a call: `function fmtVal(` used only
          // by the template would otherwise look like a call to nothing.
          if (/function\s+$/.test(c.slice(0, m.index))) continue;
          if ((globalThis as any)[name] !== undefined) continue;
          const occurrences = c.match(new RegExp('\\b' + name + '\\b', 'g'))?.length ?? 0;
          if (occurrences <= 1) offenders.push(`${p.replace(ROOT + '/', '')}: ${name}()`);
        }
      }
    };
    walk(resolve(ROOT, 'apps/web/src/pages'));
    expect(offenders).toEqual([]);
  });
});

describe('the shop has one clock and one cutoff', () => {
  it('the nav reads the operator cutoff on Kampala time, not the device', () => {
    const src = read('apps/web/src/components/GpNav.astro');
    expect(src).toMatch(/timeZone: 'Africa\/Kampala'/);
    expect(src).toMatch(/data-cutoff-hour=\{String\(biz\.sameDayCutoffHour\)\}/);
    expect(src).not.toMatch(/\(17 - h\) \* 60/);
    expect(src).not.toMatch(/hour < 17/);
  });

  it('the hero does the same, and stops defaulting to a magic 17', () => {
    const src = read('apps/web/src/components/hero/HeroSlider.astro');
    expect(src).toMatch(/data-cutoff-hour=\{String\(heroBiz\.sameDayCutoffHour\)\}/);
    expect(src).toMatch(/var now = heroShopNow\(\);/);
    expect(src).toMatch(/CONFIG\.closedDays\.indexOf\(now\.getDay\(\)\) === -1/);
  });

  it('the copy does not name a weekday the operator may not have closed', () => {
    expect(read('packages/shared/src/nav/nba.ts')).not.toMatch(/\? 'Monday' :/);
    expect(read('apps/web/src/components/GpNav.astro')).not.toMatch(/\? 'Monday' :/);
    expect(read('apps/web/src/components/GpNav.astro')).not.toMatch(/Closed Sunday\./);
  });
});

describe('one price, one stock figure', () => {
  it('search suggestions carry the campaign price', () => {
    const src = read('apps/api/src/application/use-cases/products/SearchUseCases.ts');
    expect(src).toMatch(/salePriceUgx\(retail, campaign\.percentBps, campaign\.priceFloorUgx\)/);
  });

  it('the public catalogue offers available stock, not on-hand', () => {
    expect(read('apps/api/src/application/mappers/toProductPublicDto.ts')).toMatch(/stockQuantity: entity\.availableQuantity\(\)/);
    expect(read('apps/api/src/domain/products/ProductEntity.ts')).toMatch(/Math\.max\(0, this\.stockQuantity - this\.reservedQuantity\)/);
  });

  it('the checkout points preview is a real lower bound and says so', () => {
    const src = read('apps/web/src/pages/checkout.astro');
    expect(src).toMatch(/Math\.floor\(checkoutSaleSubtotal \/ 1000\)/);
    expect(src).toMatch(/You'll earn at least/);
  });
});

describe('money moves once, and for the right amount', () => {
  it('a stale payment attempt is not reused after the total changes', () => {
    expect(read('apps/api/src/application/use-cases/commerce/StartOrderPaymentUseCase.ts'))
      .toMatch(/a\.amount === order\.totalUgx/);
  });

  it('a reversal settles only what actually came back', () => {
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleRefundLedgerRepository.ts'))
      .toMatch(/settleRefundsForAttempt\(paymentAttemptId: string, settledTotalUgx\?: number\)/);
    // The ceiling is the money COLLECTED. It was briefly `provenPartial ?
    // refunded : attempt.amount`, which is circular: `refunded` is the sum of
    // the very rows being settled, so it always covered them and capped nothing.
    expect(read('apps/api/src/application/use-cases/payments/VerifyPesaPalPaymentUseCase.ts'))
      .toMatch(/settleRefundsForAttempt\(attempt\.id, attempt\.amount\)/);
  });

  it('two identical refund requests still collapse into one', () => {
    // Deliberate: a double-click must never return the money twice. A genuine
    // second refund of the same amount and reason carries an explicit
    // idempotencyKey, which is what that input exists for. This was briefly
    // changed to key on the running refunded total and reverted, because
    // refunding twice by accident is the worse failure.
    const src = read('apps/api/src/application/use-cases/payments/RefundPesaPalPaymentUseCase.ts');
    expect(src).toMatch(/\$\{input\.merchantReference\}\|\$\{input\.amountUgx\}\|\$\{input\.reason\.trim\(\)\}`/);
    expect(src).not.toMatch(/\|\$\{alreadyRefundedUgx\}/);
  });

  it('a fee rise cannot be agreed onto an order paid in the meantime', () => {
    expect(read('apps/api/src/application/use-cases/delivery/DeliveryVarianceUseCases.ts'))
      .toMatch(/input\.agreed && order\.paymentStatus === 'paid'/);
  });

  it('only a pending variance can be answered, at the write', () => {
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleDeliveryVarianceRepository.ts'))
      .toMatch(/eq\(deliveryFeeVariance\.agreement, 'pending'\)/);
  });

  it('merged points can be spent, not just seen', () => {
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyRepository.ts'))
      .toMatch(/inArray\(loyaltyLedgerEntries\.accountId, balanceAccountIds\)/);
  });
});

describe('a failure says what it is', () => {
  it('an unreachable catalogue is a 503, not a 404', () => {
    const src = read('apps/web/src/pages/products/[slug].astro');
    expect(src).toMatch(/status: 503/);
    expect(src).toMatch(/'Retry-After': '30'/);
  });

  it('the order paths have deadlines', () => {
    expect(read('apps/web/src/lib/checkoutClient.ts').match(/AbortSignal\.timeout\(CHECKOUT_TIMEOUT_MS\)/g)?.length).toBe(2);
    expect(read('apps/web/src/pages/orders/[id].astro')).toMatch(/AbortSignal\.timeout\(8_000\)/);
  });

  it('the basket is cleared on the server, not just in the cookie', () => {
    const src = read('apps/web/src/pages/checkout.astro');
    expect(src).toMatch(/async function clearBasketAfterOrder/);
    expect(src.match(/await clearBasketAfterOrder\(\);/g)?.length).toBe(3);
  });

  it('device-priced totals are declared, never shown silently', () => {
    expect(read('apps/web/src/pages/checkout.astro')).toMatch(/these totals come from your device/);
  });
});

describe('a redirect stays on this site', () => {
  it('every redirect target goes through the hardened helper', () => {
    expect(read('apps/web/src/pages/404.astro')).toMatch(/safeReturnTo\(to, ''\)/);
    expect(read('apps/web/src/pages/account/behavioural-interventions.astro')).toMatch(/safeReturnTo\(body\.data\.ctaPath, ''\)/);
    expect(read('apps/web/src/pages/admin/login.astro')).toMatch(/safeReturnTo\(returnTo, '\/admin'\)/);
  });
});

describe('an operator edit reaches the site', () => {
  it('the WhatsApp number drives a plain wa.me link', () => {
    const src = read('apps/web/src/pages/admin/business-info.astro');
    expect(src).toMatch(/whatsappNumber: whatsappNumber,/);
    expect(src).toMatch(/https:\\\/\\\/wa\\\.me\\\/\\d\+\\\/\?\$/);
  });

  it('the nav points rate is not offered as an editable money claim', () => {
    const src = read('apps/web/src/pages/admin/nav.astro');
    const block = src.slice(src.indexOf('settings.pointsToUgxRate"'), src.indexOf('settings.pointsToUgxRate"') + 700);
    expect(block).toMatch(/readonly/);
  });

  it('a failed cart write is reported, not swallowed', () => {
    expect(read('apps/web/src/pages/cart.astro'))
      .toMatch(/cartNotice = cartNotice \?\? 'We could not update your basket just now/);
  });

  it('the category hub copy still names the address business_info holds', () => {
    // Those pages state the shop address in prose, 18 times. Templating marketing
    // sentences from a config field would read badly, so instead: if the shop
    // moves, this fails and names the pages that have to be rewritten.
    const address = read('packages/shared/src/business/index.ts');
    const line = address.match(/addressLine1: '([^']+)'/)?.[1] ?? '';
    const street = line.split(',')[0].trim();
    expect(street.length).toBeGreaterThan(3);
    expect(read('apps/web/src/lib/categoryHubs.ts')).toContain(street);
  });
});

describe('the three decisions the owner signed off', () => {
  it('an admin page needs an admin, not just a cookie', () => {
    const mw = read('apps/web/src/middleware.ts');
    expect(mw).toMatch(/const adminGuarded =/);
    expect(mw).toMatch(/!adminPath\.startsWith\('\/admin\/login'\)/);
    // Closed on a definite refusal...
    expect(mw).toMatch(/if \(res\.status === 401 \|\| res\.status === 403\) return false;/);
    // ...open when the API cannot be reached, so a blip cannot lock the operator out.
    expect(mw).toMatch(/\} catch \{\s*\n\s*return true;/);
    // Lives under /auth, not /admin: every /admin route must be gated by a
    // SPECIFIC permission, and this one deliberately asks only whether the
    // holder has any admin permission at all.
    expect(read('apps/api/src/interfaces/http/routes/auth.ts')).toMatch(/routes\.get\('\/admin-session', authMiddleware/);
  });

  it('an advertising event without an identity is not forwarded', () => {
    const src = read('apps/api/src/application/use-cases/measurement/RoutePaidSocialEventUseCase.ts');
    expect(src).toMatch(/if \(!userId && !sessionId\)/);
    expect(src).toMatch(/NO_IDENTITY/);
  });

  it('an active zone free-delivery threshold is actually read', () => {
    expect(read('apps/api/src/application/use-cases/delivery/DeliveryQuotingUseCase.ts'))
      .toMatch(/zoneFreeDeliveryThreshold \?\? numeric\.free_delivery_threshold_ugx \?\? null/);
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleDeliveryQuotingRepository.ts');
    expect(repo).toMatch(/p\.active = true/);
    expect(repo).toMatch(/p\.free_delivery_threshold_ugx is not null/);
  });
});

describe('the parameter-boundary rule can actually see array casts', () => {
  it('the pattern matches an array cast followed by a closing paren', () => {
    const src = read('tests/architecture/postgres-parameter-boundary.test.ts');
    const literal = src.match(/const RAW_CAST = (\/.*\/g);/)?.[1] ?? '';
    expect(literal).toBeTruthy();
    // Rebuild the rule's own regex and prove it sees the shape that slipped past.
    const body = literal.slice(1, literal.lastIndexOf('/'));
    const re = new RegExp(body, 'g');
    expect('where id = any(${ids}::uuid[])'.match(re)).not.toBeNull();
    expect('set c = ${x}::jsonb'.match(re)).not.toBeNull();
    // ...and does not fire on a cast that merely STARTS with one of the names.
    expect('select ${p}::jsonpath'.match(re)).toBeNull();
  });

  it('refund settlement binds its id list through the sanctioned helper', () => {
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzleRefundLedgerRepository.ts');
    expect(src).toMatch(/any\(\$\{pgUuidArray\(settleIds\)\}\)/);
    expect(src).not.toMatch(/\$\{settleIds\}::uuid\[\]/);
  });
});

describe('what the self-review of this session caught', () => {
  it('the settle budget excludes refunds already settled', () => {
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzleRefundLedgerRepository.ts');
    expect(src).toMatch(/where payment_attempt_id = \$\{paymentAttemptId\}::uuid and status = 'settled'/);
    expect(src).toMatch(/Math\.max\(0, settledTotalUgx - Number\(settledRows\[0\]\?\.settled \?\? 0\)\)/);
    // The ceiling must be the money COLLECTED, never a total derived from the
    // outstanding rows themselves — that is circular and caps nothing.
    const caller = read('apps/api/src/application/use-cases/payments/VerifyPesaPalPaymentUseCase.ts');
    expect(caller).toMatch(/settleRefundsForAttempt\(attempt\.id, attempt\.amount\)/);
    expect(caller).not.toMatch(/provenPartial \? refunded : attempt\.amount/);
  });

  it('a blank WhatsApp number does not mint a dead link', () => {
    const src = read('apps/web/src/pages/admin/business-info.astro');
    expect(src).toMatch(/whatsappUrl: whatsappDigits &&/);
  });

  it('the hero and the nav agree about a shop that never closes', () => {
    const hero = read('apps/web/src/components/hero/HeroSlider.astro');
    const fn = hero
      .slice(hero.indexOf('function heroShopClosedDays'), hero.indexOf('function heroShopClosedDays') + 600)
      .replace(/\/\/[^\n]*/g, '');   // the comment explains the removed fallback
    expect(fn).not.toMatch(/\[0\]/);
  });

  it('only a 200 proves an admin, and logout is never trapped', () => {
    const mw = read('apps/web/src/middleware.ts');
    expect(mw).toMatch(/if \(res\.ok\) return true;/);
    expect(mw).toMatch(/!adminPath\.startsWith\('\/admin\/logout'\)/);
  });
});

describe('an operator script cannot be run twice, or run anonymously', () => {
  it('a reset link is refused for a deactivated account and is audited', () => {
    const src = read('apps/api/src/scripts/issue-password-reset-link.ts');
    expect(src).toMatch(/is_active === false/);
    expect(src).toMatch(/PASSWORD_RESET_LINK_ISSUED_BY_OPERATOR/);
    expect(src).toMatch(/ACTOR_USER_ID must be the uuid of the operator/);
  });

  it('the address migration does not restate its facts on a second apply', () => {
    const src = read('apps/api/src/scripts/migrate-existing-addresses.ts');
    expect(src.match(/where not exists \(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src).not.toMatch(/values \(\$\{o\.id\}, 'system', 'migration_linked'/);
  });

  it('the synthetic monitor probes the shop from inside, not through the edge', () => {
    const src = read('apps/api/src/infrastructure/scheduler/SyntheticMonitor.ts');
    expect(src).toMatch(/SYNTHETIC_MONITOR_BASE_URL \|\| `http:\/\/localhost:\$\{process\.env\.PORT \|\| 3000\}`/);
    expect(src).not.toMatch(/const baseUrl = env\.publicApiBaseUrl/);
  });
});

describe('an imported CONSTANT is imported too, not just called functions', () => {
  it('every .astro file that uses a shared constant also imports it', () => {
    // The call-shaped scan misses this: `${SITE_ORIGIN}` is a value reference,
    // not a call, and a missing import for it throws on EVERY page that renders
    // the layout. A general "referenced but never declared" rule turned out to
    // be too noisy to keep honest (hex colours, type unions, template prose),
    // so this checks the specific shared constants that actually travel between
    // files — which is where the mistake was made.
    const SHARED = ['SITE_ORIGIN', 'STOREFRONT_PRICE_FLOOR_UGX', 'BUSINESS_SOCIAL_LABELS', 'BUSINESS_SOCIAL_KEYS'];
    const fs = require('node:fs');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!e.name.endsWith('.astro')) continue;
        const src = fs.readFileSync(p, 'utf8');
        const end = src.indexOf('\n---', 3);
        if (!src.startsWith('---') || end < 0) continue;
        const frontmatter = src.slice(3, end).replace(/\/\/[^\n]*/g, '');
        for (const name of SHARED) {
          const used = new RegExp('(?<![.\\w$])' + name + '\\b').test(frontmatter);
          if (!used) continue;
          const imported = new RegExp('import[\\s\\S]{0,400}?\\b' + name + '\\b[\\s\\S]{0,400}?from').test(frontmatter);
          if (!imported) offenders.push(`${p.replace(ROOT + '/', '')}: ${name} used but not imported`);
        }
      }
    };
    walk(resolve(ROOT, 'apps/web/src'));
    expect(offenders).toEqual([]);
  });
});

describe('what search engines are actually told', () => {
  it('robots.txt advertises a sitemap on the real site, never localhost', () => {
    const src = read('apps/web/src/pages/robots.txt.ts');
    expect(src).toMatch(/site\?\.toString\(\) \?\? SITE_ORIGIN/);
    expect(src).not.toMatch(/\?\? 'http:\/\/localhost:4321'/);
  });

  it('every page names ONE canonical host, not whichever the crawler used', () => {
    const src = read('apps/web/src/layouts/BaseLayout.astro');
    expect(src).toMatch(/const canonical = canonicalUrl \?\? `\$\{SITE_ORIGIN\}\$\{Astro\.url\.pathname\}`/);
    expect(src).not.toMatch(/\$\{Astro\.url\.origin\}\$\{Astro\.url\.pathname\}/);
  });

  it('no page builds an indexable absolute URL from the request origin', () => {
    // Canonicals, og:url and JSON-LD must all name the same host. Astro.url.origin
    // is whatever the crawler dialled, which is how www and bare ended up
    // competing. /shop and the product pages each had their own copy of this.
    const fs = require('node:fs');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.(astro|ts)$/.test(e.name)) continue;
        const src = fs.readFileSync(p, 'utf8').replace(/\/\/[^\n]*/g, '');
        if (/Astro\.url\.origin/.test(src)) offenders.push(p.replace(ROOT + '/', ''));
      }
    };
    walk(resolve(ROOT, 'apps/web/src'));
    expect(offenders).toEqual([]);
  });

  it('Search Console figures are re-read while Google is still revising them', () => {
    const src = read('apps/api/src/application/use-cases/seo-growth/SyncGscPerformanceUseCase.ts');
    expect(src).toMatch(/const REFRESH_WINDOW_DAYS = 7;/);
    expect(src).toMatch(/nextUnseen < maturingFrom \? nextUnseen : maturingFrom/);
  });
});
