// Console + network capture for a Playwright page, classified by customer
// impact. Optional third parties that are blocked (analytics, beacons) are
// recorded as OPTIONAL_THIRD_PARTY, never as commerce failures.
const OPTIONAL_HOSTS = [/cloudflareinsights\.com$/, /static\.cloudflareinsights\.com$/, /googletagmanager\.com$/, /google-analytics\.com$/, /sentry\.io$/, /facebook\.net$/, /doubleclick\.net$/];
const isOptionalHost = (url) => { try { const h = new URL(url).host; return OPTIONAL_HOSTS.some((re) => re.test(h)); } catch { return false; } };

export function attachMonitor(page, { firstPartyHost }) {
  const console_ = []; const network = [];
  page.on('console', (msg) => { if (msg.type() === 'error') console_.push({ kind: 'console.error', text: msg.text().slice(0, 300), url: page.url() }); });
  page.on('pageerror', (err) => console_.push({ kind: 'uncaught', text: String(err?.message ?? err).slice(0, 300), url: page.url() }));
  page.on('requestfailed', (req) => {
    const url = req.url(); const et = req.failure()?.errorText ?? '';
    if (/net::ERR_ABORTED/.test(et)) return; // navigations cancel in-flight requests; not a failure
    network.push({ kind: 'failed', url: url.slice(0, 200), error: et, type: req.resourceType(), impact: classifyImpact(url, req.resourceType(), firstPartyHost) });
  });
  page.on('response', (res) => {
    const st = res.status(); const url = res.url();
    if (st >= 400) network.push({ kind: `http_${st}`, url: url.slice(0, 200), type: res.request().resourceType(), impact: classifyImpact(url, res.request().resourceType(), firstPartyHost) });
  });
  return {
    console: console_, network,
    snapshot() { return { console: [...console_], network: [...network] }; },
    commerceFailures() { return network.filter((n) => n.impact === 'COMMERCE'); },
  };
}

export function classifyImpact(url, resourceType, firstPartyHost) {
  if (isOptionalHost(url)) return 'OPTIONAL_THIRD_PARTY';
  let host = ''; try { host = new URL(url).host.replace(/^www\./, ''); } catch { /* ignore */ }
  const firstParty = host === firstPartyHost || host.endsWith(`.${firstPartyHost}`);
  if (!firstParty) return 'THIRD_PARTY';
  if (['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(resourceType)) return 'COMMERCE';
  if (resourceType === 'font') return 'DEGRADED_TYPOGRAPHY';
  if (resourceType === 'image') return 'DEGRADED_MEDIA';
  return 'MINOR';
}
