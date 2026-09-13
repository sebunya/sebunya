// Constrained profiles (Chromium only: CDP). Firefox/WebKit cannot throttle
// CPU or network through Playwright; those cells are ENGINE_CONTROL only and
// the matrices say so. Network figures are plausible classes, not a measured
// Ugandan carrier profile.
export const NETWORK_PROFILES = Object.freeze({
  fast_reference: { label: 'Fast reference', offline: false, latency: 20, downloadThroughput: 50 * 1024 * 1024 / 8, uploadThroughput: 20 * 1024 * 1024 / 8 },
  normal_4g: { label: 'Normal 4G', offline: false, latency: 70, downloadThroughput: 9 * 1024 * 1024 / 8, uploadThroughput: 3 * 1024 * 1024 / 8 },
  slow_mobile: { label: 'Slow mobile (3G-like)', offline: false, latency: 300, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 },
  high_latency: { label: 'High latency', offline: false, latency: 800, downloadThroughput: 4 * 1024 * 1024 / 8, uploadThroughput: 1 * 1024 * 1024 / 8 },
  severe_constrained: { label: 'Severe but plausible constrained mobile', offline: false, latency: 500, downloadThroughput: 400 * 1024 / 8, uploadThroughput: 200 * 1024 / 8 },
});
export const CPU_PROFILES = Object.freeze({ reference: 1, mainstream_android: 2, low_end_android: 4, very_low_end: 6 });

export async function applyProfile(page, { network, cpu }) {
  const cdp = await page.context().newCDPSession(page);
  if (network) { const n = NETWORK_PROFILES[network]; await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: n.latency, downloadThroughput: n.downloadThroughput, uploadThroughput: n.uploadThroughput }); }
  if (cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_PROFILES[cpu] ?? Number(cpu) });
  return cdp;
}

export async function longTasks(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const out = []; try { const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) out.push(Math.round(e.duration)); }); po.observe({ type: 'longtask', buffered: true }); } catch { /* unsupported */ }
    setTimeout(() => resolve(out), 300);
  }));
}
