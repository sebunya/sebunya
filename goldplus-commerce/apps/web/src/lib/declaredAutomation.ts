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

export function isDeclaredAutomation(userAgent: string | null | undefined): boolean {
  return !!userAgent && DECLARED.test(userAgent);
}
