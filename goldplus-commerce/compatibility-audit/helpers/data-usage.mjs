// Transfer accounting per journey step, by resource class, first vs third party.
// Uses the response's Content-Length / body size as reported by Playwright
// (sizes() via CDP where available; falls back to headers). Cold = fresh
// context; warm = second navigation in the same context (HTTP cache active).
export function startAccounting(page, { firstPartyHost }) {
  const rows = [];
  page.on('response', async (res) => {
    const req = res.request(); const url = res.url();
    let bytes = 0;
    try { const s = await req.sizes(); bytes = (s.responseBodySize ?? 0) + (s.responseHeadersSize ?? 0); }
    catch { const cl = Number(res.headers()['content-length']); bytes = Number.isFinite(cl) ? cl : 0; }
    let host = ''; try { host = new URL(url).host.replace(/^www\./, ''); } catch { /* ignore */ }
    const firstParty = host === firstPartyHost || host.endsWith(`.${firstPartyHost}`);
    rows.push({ url: url.slice(0, 160), type: req.resourceType(), bytes, firstParty, fromCache: res.fromServiceWorker() ? 'sw' : (res.status() === 304 ? 'revalidated' : 'network') });
  });
  return {
    rows,
    total() {
      const t = { total_bytes: 0, html_bytes: 0, js_bytes: 0, css_bytes: 0, image_bytes: 0, font_bytes: 0, api_bytes: 0, third_party_bytes: 0, other_bytes: 0, requests: rows.length, third_party_requests: 0 };
      for (const r of rows) {
        t.total_bytes += r.bytes;
        if (!r.firstParty) { t.third_party_bytes += r.bytes; t.third_party_requests++; continue; }
        if (r.type === 'document') t.html_bytes += r.bytes; else if (r.type === 'script') t.js_bytes += r.bytes; else if (r.type === 'stylesheet') t.css_bytes += r.bytes;
        else if (r.type === 'image') t.image_bytes += r.bytes; else if (r.type === 'font') t.font_bytes += r.bytes; else if (r.type === 'fetch' || r.type === 'xhr') t.api_bytes += r.bytes; else t.other_bytes += r.bytes;
      }
      return t;
    },
    reset() { rows.length = 0; },
  };
}
