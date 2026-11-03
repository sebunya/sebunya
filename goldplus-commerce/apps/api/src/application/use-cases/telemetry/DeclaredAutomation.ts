/**
 * User agents that SAY they are automation: our own probes
 * (GoldPlusSyntheticProbe: Lighthouse Watch, the rolling audits) and the lab
 * tools that name themselves. Same list as the storefront's relays
 * (apps/web/src/lib/declaredAutomation.ts), which already dropped them; the
 * collector did not, so every Lighthouse run and audit journey became a GA4
 * visitor and an ad-platform ViewContent/AddToCart.
 *
 * Not bot detection, and it grants nothing: the only effect is that the
 * sender's behavioural events are not recorded, so claiming it only opts the
 * claimant out. Landing touches are still kept, classed 'automated'.
 */
const DECLARED = /GoldPlusSyntheticProbe|Chrome-Lighthouse|HeadlessChrome|PageSpeed|GTmetrix|PTST\/|Playwright|Puppeteer/i;

/**
 * The storefront forwards the audits' probe cookie (gp_probe, see apps/web/src/lib/declaredAutomation.ts) to the
 * API as this header when it adds to a basket on the visitor's behalf; the API never sees the browser's cookies.
 */
export const PROBE_HEADER = 'x-goldplus-probe';

export function isDeclaredAutomationUa(userAgent: string | null | undefined): boolean {
  return !!userAgent && DECLARED.test(userAgent);
}
