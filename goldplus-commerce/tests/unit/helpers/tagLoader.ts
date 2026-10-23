import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { ANALYTICS_REDACTED_PARAMS, loaderRules } from '../../../packages/shared/src';
import { DECLARED } from '../../../apps/web/src/lib/declaredAutomation';

/**
 * The REAL tag loader from BaseLayout (the inline script, as shipped), run against a fake page with the same rulebook
 * data the layout passes it. Used by the attribution tests and the attribution contract.
 */
export const loaderRulesAsShipped = () => ({ ...loaderRules(), red: ANALYTICS_REDACTED_PARAMS.source, bots: DECLARED.source });

function loaderSource(): string {
  const layout = readFileSync(resolve(__dirname, '../../../apps/web/src/layouts/BaseLayout.astro'), 'utf8');
  const start = layout.indexOf('        (function () {\n        var ua = navigator.userAgent');
  const end = layout.indexOf('        })();', start);
  if (start < 0 || end < 0) throw new Error('tag loader not found in BaseLayout');
  return layout.slice(start, end + '        })();'.length);
}

export function page(href: string, opts: { referrer?: string; cookie?: string; store?: Map<string, string>; ua?: string } = {}) {
  const store = opts.store ?? new Map<string, string>();
  const scripts: Array<{ src?: string; onload?: () => void }> = [];
  const listeners: Record<string, Array<() => void>> = {};
  const loc = { href, hostname: new URL(href).hostname, origin: new URL(href).origin };
  const win: Record<string, unknown> = {};
  const ctx: Record<string, unknown> = {
    window: win, URL, JSON, Date, Math, RegExp, crypto: globalThis.crypto, decodeURIComponent, encodeURIComponent, Array, Object,
    navigator: { userAgent: opts.ua ?? 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile', webdriver: false },
    location: loc,
    history: { state: null, replaceState: (_s: unknown, _t: string, u: string) => { loc.href = u; } },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    document: {
      cookie: opts.cookie ?? '_fp_cid=fp.1.00000000-0000-4000-8000-000000000000', referrer: opts.referrer ?? '', readyState: 'loading',
      createElement: () => { const s: { src?: string; onload?: () => void; async?: boolean } = {}; scripts.push(s); return s; },
      head: { appendChild: () => undefined },
    },
    addEventListener: (t: string, f: () => void) => { (listeners[t] ??= []).push(f); },
    metricsUrl: 'https://metrics.shopgoldplus.com', gtmId: 'GTM-TEST', userId: null, adSignals: false,
    rules: JSON.parse(JSON.stringify(loaderRulesAsShipped())), // as define:vars serialises it
  };
  Object.assign(win, ctx);
  ctx.dataLayer = undefined;
  // `window.x = …` and bare `x` must be the same binding, as in a browser.
  const proxy = new Proxy(ctx, { get: (t, k) => (k in t ? t[k as string] : win[k as string]), set: (t, k, v) => { t[k as string] = v; win[k as string] = v; return true; } });
  (proxy as Record<string, unknown>).window = proxy;
  runInNewContext(loaderSource(), proxy as never);
  return { loc, store, scripts, listeners, win, dl: (win.dataLayer ?? (proxy as Record<string, unknown>).dataLayer) as unknown[] };
}

/** What the page told the Google tag with gtag('set', …) before it loaded. */
export const sets = (dl: unknown[]) => Object.assign({}, ...(dl ?? []).filter((e) => (e as IArguments)[0] === 'set').map((e) => (e as IArguments)[1]));
