import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const seen = new Set(); const problems = [];
for (const mode of ['new', 'returning', 'regular', 'expired', 'aftercutoff']) {
  for (const [label, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]]) {
    const page = await browser.newPage({ viewport: vp });
    await page.goto(`https://www.shopgoldplus.com/?gp=${mode}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4500);
    const r = await page.evaluate(async () => {
      const out = []; const box = document.querySelector('.gp-hero__box').getBoundingClientRect();
      for (const s of document.querySelectorAll('.gp-hero__slide')) {
        document.querySelectorAll('.gp-hero__slide').forEach(o => { o.hidden = o !== s; o.toggleAttribute('data-active', o === s); });
        await new Promise(r => setTimeout(r, 650));
        const over = [...s.querySelectorAll('.gp-hero__copy *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.bottom > box.bottom + 0.5 || r.right > box.right + 0.5); }).map(e => e.className.split(' ')[0] || e.tagName);
        const imgs = [...s.querySelectorAll('img')].map(i => i.complete && i.naturalWidth > 0);
        out.push({ id: s.dataset.id, over: [...new Set(over)], imgOk: imgs.every(Boolean), text: s.querySelector('.gp-hero__copy')?.innerText.replace(/\s+/g, ' ').slice(0, 140) });
      }
      return out;
    });
    for (const x of r) { const key = `${label}:${x.id}`; if (!seen.has(key)) { seen.add(key); if (x.over.length || !x.imgOk) problems.push({ mode, label, ...x }); } }
    await page.close();
  }
}
console.log('slides checked:', [...seen].join(', '));
console.log('problems:', JSON.stringify(problems));
await browser.close();
