// Console + network capture for a Playwright page, classified by customer
// impact. Optional third parties that are blocked (analytics, beacons) are
// recorded as OPTIONAL_THIRD_PARTY, never as commerce failures.
const OPTIONAL_HOSTS = [/cloudflareinsights\.com$/, /static\.cloudflareinsights\.com$/, /challenges\.cloudflare\.com$/, /googletagmanager\.com$/, /google-analytics\.com$/, /sentry\.io$/, /facebook\.net$/, /doubleclick\.net$/];
const isOptionalHost = (url) => { try { const h = new URL(url).host; return OPTIONAL_HOSTS.some((re) => re.test(h)); } catch { return false; } };

export function attachMonitor(page, { firstPartyHost }) {
  const console_ = []; const network = [];
  page.on('console', (msg) => { if (msg.type() === 'error') console_.push({ kind: 'console.error', text: msg.text().slice(0, 300), url: page.url() }); });
  page.on('pageerror', (err) => console_.push({ kind: 'uncaught', text: String(err?.message ?? err).slice(0, 300), url: page.url() }));
  page.on('requestfailed', (req) => {
    const url = req.url(); const et = req.failure()?.errorText ?? '';
    if (/net::ERR_ABORTED|NS_BINDING_ABORTED|cancelled|canceled|Load cancelled/i.test(et)) return; // navigations and AbortController cancel in-flight requests; not failures
    network.push({ kind: 'failed', url: url.slice(0, 200), error: et, type: req.resourceType(), impact: classifyImpact(url, req.resourceType(), firstPartyHost) });
  });
  page.on('response', (res) => {
    const st = res.status(); const url = res.url();
    // Cloudflare marks its challenge/block interstitials with cf-mitigated. From a datacenter IP a
    // headless browser earns one regardless of the storefront: recorded as BLOCKED_BY_EDGE, never as
    // a defect, and never evaded.
    const h = res.headers(); const mitigated = h['cf-mitigated'];
    const edgeBlock = res.request().resourceType() === 'document' && (mitigated || ((st === 403 || st === 503) && /cloudflare/i.test(h['server'] ?? '') && !h['x-astro-route'] && !h['content-security-policy']));
    if (edgeBlock) { network.push({ kind: 'cf_challenge', url: url.slice(0, 200), type: 'document', mitigated: mitigated ?? `http_${st}`, impact: 'BLOCKED_BY_EDGE' }); return; }
    if (st >= 400) network.push({ kind: `http_${st}`, url: url.slice(0, 200), type: res.request().resourceType(), impact: classifyImpact(url, res.request().resourceType(), firstPartyHost) });
  });
  return {
    console: console_, network,
    snapshot() { return { console: [...console_], network: [...network] }; },
    commerceFailures() { return network.filter((n) => n.impact === 'COMMERCE'); },
    blockedByEdge() { return network.some((n) => n.kind === 'cf_challenge'); },
  };
}

// First-party analytics relays (nav/hero/recommendation events, telemetry): their
// rejection of automated traffic (the API's bot detection answers 403 to a
// headless UA) is expected and never a commerce failure.
const FIRST_PARTY_ANALYTICS = [/\/api\/nav\/events/, /\/api\/hero\/events/, /\/api\/hero\/signals/, /\/api\/rec\//, /\/telemetry\//, /\/cdn-cgi\/rum/];

export function classifyImpact(url, resourceType, firstPartyHost) {
  if (isOptionalHost(url)) return 'OPTIONAL_THIRD_PARTY';
  if (FIRST_PARTY_ANALYTICS.some((re) => re.test(url))) return 'FIRST_PARTY_ANALYTICS';
  let host = ''; try { host = new URL(url).host.replace(/^www\./, ''); } catch { /* ignore */ }
  const firstParty = host === firstPartyHost || host.endsWith(`.${firstPartyHost}`);
  if (!firstParty) return 'THIRD_PARTY';
  if (['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(resourceType)) return 'COMMERCE';
  if (resourceType === 'font') return 'DEGRADED_TYPOGRAPHY';
  if (resourceType === 'image') return 'DEGRADED_MEDIA';
  return 'MINOR';
}
