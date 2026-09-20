/**
 * Browsers that TELL us they are automation: our own probes
 * (GoldPlusSyntheticProbe — Lighthouse Watch, the rolling audits) and the
 * lab tools that self-identify. They run our JavaScript and keep cookies, so
 * without this they record product views like a shopper would.
 *
 * This is NOT bot detection and grants nothing: the only effect is that the
 * sender's events are not recorded, so lying about it only opts the liar out.
 * Undeclared automation is a measured residual, not something guessed at here.
 */
const DECLARED = /GoldPlusSyntheticProbe|Chrome-Lighthouse|HeadlessChrome|PageSpeed|GTmetrix|PTST\/|Playwright/i;

/**
 * Our own Playwright audits keep each engine's REAL user agent (that is what
 * they test), so they declare themselves with a first-party cookie instead. A
 * cookie, not a header: a custom header would also be sent to every third-party
 * host and trigger CORS preflights that break the audit's own page loads.
 */
export const PROBE_COOKIE = 'gp_probe';

export function isDeclaredAutomation(source: string | null | undefined | Headers): boolean {
  if (source && typeof source === 'object') {
    return new RegExp(`(^|;\\s*)${PROBE_COOKIE}=`).test(source.get('cookie') ?? '') || isDeclaredAutomation(source.get('user-agent'));
  }
  return !!source && DECLARED.test(source);
}
