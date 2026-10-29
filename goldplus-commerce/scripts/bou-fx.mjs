#!/usr/bin/env node
/**
 * Bank of Uganda dollar rate, read at 1 pm Kampala (2026-10-24).
 *
 * bou.or.ug/interest_rates_exchange_rates is a Power BI report embedded with a public token the site hands out
 * (bou.or.ug/api/power-bi/token). There is no documented JSON feed, so this opens the page in a real browser,
 * asks the Power BI client already on the page to export the "Major Exchange Rates" table, takes the
 * U.S. Dollar/Uganda Shillings row (Cross Rates = mid, Buying, Selling) and posts it to the shop:
 * POST $API_URL/internal/fx/bou with header x-bou-fx-token: $BOU_FX_TOKEN.
 *
 * Run by .github/workflows/bou-fx.yml at 10:00 UTC Monday to Friday (13:00 EAT; BoU posts no weekend rate).
 * Locally: API_URL=https://api.shopgoldplus.com BOU_FX_TOKEN=… node scripts/bou-fx.mjs [--dry-run]
 * Exit 0 only when the row was read and (unless --dry-run) the shop accepted it.
 */
import { chromium } from '@playwright/test';

const PAGE = 'https://www.bou.or.ug/interest_rates_exchange_rates';
const API_URL = (process.env.API_URL ?? 'https://api.shopgoldplus.com').replace(/\/$/, '');
const TOKEN = (process.env.BOU_FX_TOKEN ?? '').trim();
const DRY = process.argv.includes('--dry-run');
const kampalaDay = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

/** The USD/UGX rates out of the table's CSV export. Exported for the unit test. */
export function parseUsdRow(csv) {
  const out = { mid: null, buying: null, selling: null };
  for (const line of String(csv).split(/\r?\n/)) {
    const cells = line.split(',');
    if (cells.length < 4) continue;
    const name = cells[1]?.trim() ?? '';
    if (!/^U\.S\. Dollar\/Uganda Shillings/i.test(name)) continue;
    const kind = (cells[2] ?? '').trim().toLowerCase();
    const value = Number(cells.slice(3).join(',').replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(value)) continue;
    if (kind.startsWith('cross')) out.mid = value;
    else if (kind.startsWith('buying')) out.buying = value;
    else if (kind.startsWith('selling')) out.selling = value;
  }
  // BoU's "cross rate" for the shilling pair is the mid; if it were ever missing, the mean of the two sides is.
  if (out.mid === null && out.buying !== null && out.selling !== null) out.mid = (out.buying + out.selling) / 2;
  return out;
}

async function readFromPage() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => Boolean(window.powerbi && document.querySelector('iframe')), null, { timeout: 90_000 });
    const csv = await page.evaluate(async () => {
      const svc = window.powerbi;
      const el = document.querySelector('iframe').parentElement;
      const report = svc.get(el);
      const deadline = Date.now() + 90_000;
      for (;;) {
        try {
          const pages = await report.getPages();
          const major = pages.find((p) => p.displayName === 'Major Exchange Rates') ?? pages[0];
          const visuals = await major.getVisuals();
          const table = visuals.find((v) => v.type === 'pivotTable' || /table/i.test(v.type));
          if (table) { const d = await table.exportData(0, 2000); return String(d.data); }
        } catch (e) { /* report still loading */ }
        if (Date.now() > deadline) throw new Error('the Power BI report never exposed its rates table');
        await new Promise((r) => setTimeout(r, 2000));
      }
    });
    return csv;
  } finally {
    await browser.close();
  }
}

async function main() {
  const csv = await readFromPage();
  const row = parseUsdRow(csv);
  if (row.mid === null) { console.error('no U.S. Dollar/Uganda Shillings row in the export; first lines:\n' + String(csv).split('\n').slice(0, 6).join('\n')); process.exit(2); }
  // Dated by the run day: the export's rows carry no date (their first cell is '.'), so a table BoU has not yet
  // refreshed by 13:00 is filed under today. The AllRatesToday path dates by BoU's own rate_date (2026-10-29 review).
  const reading = { day: kampalaDay(), mid: row.mid, buying: row.buying, selling: row.selling, source: 'bou.or.ug Power BI export' };
  console.log(JSON.stringify(reading));
  if (DRY) return;
  if (TOKEN.length < 32) { console.error('BOU_FX_TOKEN is not set (32+ characters)'); process.exit(3); }
  const res = await fetch(`${API_URL}/internal/fx/bou`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bou-fx-token': TOKEN }, body: JSON.stringify(reading) });
  const body = await res.text();
  if (!res.ok) { console.error(`shop refused the reading: HTTP ${res.status} ${body.slice(0, 300)}`); process.exit(4); }
  console.log(`recorded: ${body.slice(0, 200)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err?.stack ?? String(err)); process.exit(1); });
