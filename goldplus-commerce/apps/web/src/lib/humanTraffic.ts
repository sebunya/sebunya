/**
 * Is this request plausibly a person?
 *
 * Search demand is a PURCHASING signal: the admin queue built from it tells the
 * owner what customers wanted and could not find, and that decides what stock to
 * buy. So it must count people, not machines. Every server-rendered
 * `/shop?search=` was being recorded, which meant crawlers, uptime checks and
 * one engineer running curl in a loop all registered as demand — and a query
 * nobody ever typed can look like hundreds of lost sales.
 *
 * Deliberately conservative: this excludes things that ANNOUNCE themselves as
 * automated and keeps everything else. A missed bot only dilutes the signal; a
 * wrongly excluded person loses a real customer's request, which is worse.
 */

const AUTOMATED = [
  'bot', 'crawler', 'spider', 'slurp', 'crawling',
  'curl', 'wget', 'python-requests', 'python-httpx', 'go-http-client',
  'java/', 'okhttp', 'axios', 'node-fetch', 'undici', 'got (',
  'headlesschrome', 'phantomjs', 'puppeteer', 'playwright', 'selenium',
  'lighthouse', 'pingdom', 'uptimerobot', 'statuscake', 'newrelic', 'datadog',
  'ahrefs', 'semrush', 'mj12', 'dotbot', 'petalbot', 'bytespider',
  'facebookexternalhit', 'whatsapp', 'telegrambot', 'discordbot', 'slackbot',
  'preview', 'monitor', 'probe', 'scanner', 'postman', 'insomnia',
];

export function isLikelyHuman(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? '').trim().toLowerCase();
  // No user agent at all is a script, not a browser.
  if (!ua) return false;
  if (AUTOMATED.some((needle) => ua.includes(needle))) return false;
  // Every real browser announces Mozilla/5.0; requiring it keeps the rule
  // positive rather than an endless list of things to exclude.
  return ua.includes('mozilla/');
}
