/**
 * Goldie's conversation panel. Loaded on the first interaction (launcher
 * hover, tap or an inline "Ask Goldie" question), not with every page: the
 * component's own script carries only the launcher and its awareness layer.
 *
 * The browser posts the conversation to /api/assistant/chat (same origin)
 * and renders the streamed answer. Product cards and action chips come from
 * the validated `products` and `links` events the server sends, never from
 * the model's prose. A card with a catalogue id, a price and stock offers
 * "Add to cart": the same POST the product page makes, so the shopper can
 * ask, see, and add in two taps without leaving the conversation.
 *
 * The transcript lives in sessionStorage for this tab only (wrapped in
 * try/catch); the server does not store it. The shopper can keep it (save or
 * share on the phone, or "Email me this chat") or pass it to the team by email
 * ("Email the team": a support ticket plus an email the shop can Reply to).
 *
 * Goldie answers at a human pace: a short pause to read the question, then the
 * reply appears word by word (goldieGreeting.ts holds the numbers); product
 * cards and chips follow once the sentence is written. Reduced motion: no
 * word-by-word reveal, a short pause only.
 */
type Turn = { role: 'user' | 'assistant'; content: string };
type Card = { id: string | null; name: string; url: string; sku: string | null; price_ugx: number | null; availability: string; image: string | null; category: string | null; note?: string };
type Chip = { label: string; url: string };
type Ev = { type: 'text'; text: string } | { type: 'tool'; name: string } | { type: 'products'; items: Card[] } | { type: 'links'; items: Chip[] } | { type: 'done' } | { type: 'error'; code: string; message: string };

import type { GoldieQuestion } from '../lib/goldieQuestions';
import { goldieAvatarImg } from '../lib/goldieAvatar';
import { NO_HELLO, goldieGreeting, kampalaHour, readPauseMs, returningChip, revealStep, transcriptText, welcomeTeaser, type GoldieHello } from '../lib/goldieGreeting';
import { TEAM_HANDOVER_PATH } from '../lib/goldieLinks';
export type Teaser = { key: string; text: string; chips: GoldieQuestion[]; asksPhone?: boolean };
export interface PanelContext {
  endpoint: string;
  reduced: boolean;
  /** Phone-width viewport: the keyboard is not raised until the shopper taps the box, so the greeting and chips stay visible. */
  narrow: () => boolean;
  knownPhone: string;
  /** Fallback greeting (used only if the personal one cannot be built). */
  greeting: string;
  /** GET endpoint for the personal welcome (first name, returning, last interest). */
  helloEndpoint?: string;
  track: (type: string, itemKey: string) => void;
  /** The page's teaser, if one was shown: the panel opens with that message and its questions first. */
  getTeaser: () => Teaser | null;
  /** The launcher's side of opening: hide the teaser, clear the unread dot. */
  onOpen: () => void;
  /** Optional: run a DOM change as the launcher-to-panel morph (View Transitions); without it the change is instant. */
  morph?: (update: () => void, toPanel: boolean) => void;
}
export interface GoldiePanel { open: () => void; close: () => void; ask: (question: string) => Promise<void>; isOpen: () => boolean }

const KEY = 'gp-assistant-turns', SEEN = 'gp-assistant-seen', HELLO = 'gp-goldie-welcome'; // not gp-goldie-hello: the launcher's wordmark glint owns that key
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mountGoldie(root: HTMLElement, ctx: PanelContext): GoldiePanel {
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const launch = q<HTMLButtonElement>('[data-launch]'), panel = q<HTMLElement>('[data-panel]'), closeBtn = q<HTMLButtonElement>('[data-close]');
  const clearBtn = q<HTMLButtonElement>('[data-clear]'), log = q<HTMLElement>('[data-log]'), starters = q<HTMLElement>('[data-starters]');
  const form = q<HTMLFormElement>('[data-form]'), input = q<HTMLTextAreaElement>('[data-input]'), send = q<HTMLButtonElement>('[data-send]');
  const tools = root.querySelector<HTMLElement>('[data-tools]');
  const SITE = location.origin;
  let turns: Turn[] = [];
  let busy = false;
  let greeted = false;

  // The personal welcome: read once per tab (sessionStorage), in the background, as the panel code loads.
  let hello: GoldieHello = NO_HELLO;
  try { const h = sessionStorage.getItem(HELLO); if (h) hello = { ...NO_HELLO, ...JSON.parse(h) }; } catch { hello = NO_HELLO; }
  const helloP: Promise<void> = (async () => {
    if (!ctx.helloEndpoint) return;
    try { if (sessionStorage.getItem(HELLO)) return; } catch { /* storage blocked: fetch anyway */ }
    try {
      const res = await fetch(ctx.helloEndpoint, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      hello = { ...NO_HELLO, ...(await res.json()) };
      try { sessionStorage.setItem(HELLO, JSON.stringify(hello)); } catch { /* ignore */ }
    } catch { /* a new shopper, as far as Goldie knows */ }
  })();
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const greetingText = () => { try { return goldieGreeting(hello, kampalaHour(), ctx.knownPhone); } catch { return ctx.greeting; } };

  try { const saved = sessionStorage.getItem(KEY); if (saved) turns = JSON.parse(saved); } catch { turns = []; }
  const persist = () => { try { sessionStorage.setItem(KEY, JSON.stringify(turns.slice(-12))); } catch { /* private mode or blocked storage */ } };
  const ugx = (n: number | null) => (n == null ? 'Price on request' : `UGX ${n.toLocaleString('en-UG')}`);
  const AVAIL: Record<string, string> = { in_stock: 'In stock', low_stock: 'Low stock', out_of_stock: 'Out of stock', pre_order: 'Pre-order' };
  const TOOL_STATUS: Record<string, string> = {
    search_products: 'checking the shelf…', get_product: 'reading the product page…', list_categories: 'checking the categories…',
    find_battery: 'running the battery finder…', store_info: 'checking the shop details…',
  };
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

  /** Text to DOM: minimal markdown (**bold**, "- " bullets), links only to this site (anything else stays plain text). */
  const render = (el: HTMLElement, text: string) => {
    el.replaceChildren();
    const clean = text.replace(/^\s*[-*]\s+/gm, '• ').replace(/^#+\s*/gm, '');
    for (const seg of clean.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s)\]>]+)/g)) {
      if (!seg) continue;
      if (/^\*\*[^*]+\*\*$/.test(seg)) { const b = document.createElement('strong'); b.textContent = seg.slice(2, -2); el.append(b); continue; }
      if (/^https?:\/\//.test(seg)) {
        const url = seg.replace(/[.,;:!?]+$/, ''), trail = seg.slice(url.length);
        if (url.startsWith(SITE + '/') || url === SITE) {
          const a = document.createElement('a'); a.href = url; a.rel = 'noopener';
          const path = url.replace(SITE, '');
          a.textContent = path.startsWith('/products/') ? 'the product page' : path.startsWith('/wa') ? 'WhatsApp' : path || 'the site';
          el.append(a); if (trail) el.append(trail);
        } else el.append(seg);
        continue;
      }
      el.append(seg.replace(/\*/g, ''));
    }
  };
  const avatar = () => { const a = document.createElement('span'); a.className = 'gp-assistant__avatar gp-assistant__avatar--sm'; a.setAttribute('aria-hidden', 'true'); const g = document.createElement('span'); g.textContent = 'G'; a.append(g, goldieAvatarImg(28)); return a; };
  const bubble = (kind: 'user' | 'bot' | 'error', text: string) => {
    const row = document.createElement('div'); row.className = `gp-assistant__row gp-assistant__row--${kind === 'user' ? 'user' : 'bot'}`;
    const el = document.createElement('div'); el.className = `gp-assistant__msg gp-assistant__msg--${kind}`;
    if (kind === 'bot') render(el, text); else el.textContent = text;
    if (kind !== 'user') row.append(avatar());
    row.append(el); log.append(row); log.scrollTop = log.scrollHeight; return { row, el };
  };
  const typing = () => {
    const row = document.createElement('div'); row.className = 'gp-assistant__row gp-assistant__row--bot';
    const t = document.createElement('div'); t.className = 'gp-assistant__msg gp-assistant__msg--bot gp-assistant__typing'; t.setAttribute('aria-label', 'Goldie is typing');
    for (let i = 0; i < 3; i += 1) t.append(document.createElement('i'));
    row.append(avatar(), t); log.append(row);
    const status = document.createElement('p'); status.className = 'gp-assistant__status'; status.textContent = ''; log.append(status);
    log.scrollTop = log.scrollHeight; return { row, status };
  };
  const chips = (items: Chip[]) => {
    const wrap = document.createElement('div'); wrap.className = 'gp-assistant__chips';
    for (const it of items) {
      if (it.url === SITE + TEAM_HANDOVER_PATH) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'gp-assistant__chip'; b.textContent = it.label;
        b.addEventListener('click', () => teamForm()); wrap.append(b); continue;
      }
      const ok = it.url.startsWith(SITE + '/') || /^https:\/\/(wa\.me|maps\.google\.com|www\.google\.com\/maps|goo\.gl\/maps|maps\.app\.goo\.gl)\//.test(it.url);
      if (!ok) continue;
      const a = document.createElement('a'); a.className = 'gp-assistant__chip'; a.href = it.url; a.textContent = it.label;
      if (!it.url.startsWith(SITE)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      wrap.append(a);
    }
    if (wrap.childElementCount) { log.append(wrap); log.scrollTop = log.scrollHeight; }
  };

  /** Add to cart from a card: the product page's own POST, read for its result (the cart redirects to
   *  /cart?added=<id> only when the server accepted the line). The header badge is bumped through the
   *  nav's own updater, so the shopper sees the count change without leaving the conversation. */
  const addToCart = async (it: Card, btn: HTMLButtonElement, note: HTMLElement) => {
    if (!it.id) return;
    btn.disabled = true; btn.textContent = 'Adding…'; note.textContent = '';
    const fd = new FormData();
    fd.set('action', 'add'); fd.set('productId', it.id); fd.set('slug', it.url.replace(/^.*\/products\//, '').split(/[?#]/)[0]);
    fd.set('name', it.name); fd.set('categoryName', it.category ?? ''); fd.set('priceUgx', String(it.price_ugx ?? 0));
    try {
      const res = await fetch('/cart', { method: 'POST', body: fd, credentials: 'same-origin', redirect: 'follow' });
      let added = false; try { added = res.ok && new URL(res.url).searchParams.get('added') === it.id; } catch { added = false; }
      if (added) {
        const a = document.createElement('a'); a.className = 'gp-assistant__add gp-assistant__add--done'; a.href = `/cart#line-${it.id}`; a.textContent = 'Added · View cart'; a.setAttribute('aria-label', `${it.name} added to cart. View cart`);
        btn.replaceWith(a);
        const badge = document.getElementById('gpNavCart'); const n = (parseInt(badge?.textContent || '0', 10) || 0) + 1;
        const w = window as unknown as { gpCartCount?: (n: number) => void }; try { w.gpCartCount?.(n); } catch { /* nav not present */ }
        ctx.track('NBA_CLICK', 'goldie-cart-add');
      } else {
        // The server did not accept the line (stock, limit); the cart page explains why.
        const a = document.createElement('a'); a.className = 'gp-assistant__add'; a.href = '/cart'; a.textContent = 'Open the cart';
        btn.replaceWith(a); note.textContent = 'Could not add it; the cart page says why.';
      }
    } catch {
      btn.disabled = false; btn.textContent = 'Add to cart'; note.textContent = 'The connection dropped. Try again?';
    }
  };
  const cards = (items: Card[]) => {
    const wrap = document.createElement('div'); wrap.className = 'gp-assistant__cards';
    for (const it of items) {
      if (!it.url.startsWith(SITE + '/')) continue;
      const card = document.createElement('div'); card.className = 'gp-assistant__card';
      const link = document.createElement('a'); link.className = 'gp-assistant__card-link'; link.href = it.url;
      if (it.image) { const img = document.createElement('img'); img.src = it.image; img.alt = ''; img.loading = 'lazy'; link.append(img); } else { const ph = document.createElement('div'); ph.className = 'ph'; link.append(ph); }
      const body = document.createElement('div');
      const b = document.createElement('b'); b.textContent = it.name; body.append(b);
      const p = document.createElement('span'); p.className = 'price'; p.textContent = ugx(it.price_ugx); body.append(p);
      const m = document.createElement('span'); m.className = `meta${it.availability === 'in_stock' ? ' meta--in' : ''}`; m.textContent = `${AVAIL[it.availability] ?? it.availability}${it.note ? ` · ${it.note}` : ''}`; body.append(m);
      link.append(body); card.append(link);
      const canAdd = it.id != null && UUID.test(it.id) && it.price_ugx != null && (it.availability === 'in_stock' || it.availability === 'low_stock');
      if (canAdd) {
        const act = document.createElement('div'); act.className = 'gp-assistant__card-act';
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'gp-assistant__add'; btn.textContent = 'Add to cart'; btn.setAttribute('aria-label', `Add ${it.name} to cart`);
        const note = document.createElement('span'); note.className = 'gp-assistant__add-note';
        btn.addEventListener('click', () => { void addToCart(it, btn, note); });
        act.append(btn, note); card.append(act);
      }
      wrap.append(card);
    }
    if (wrap.childElementCount) { log.append(wrap); log.scrollTop = log.scrollHeight; }
  };

  /** The panel's opening line and starter chips. When a teaser was shown for this page, the panel
   *  opens with that same message and its questions first, so the folded-away teaser loses nothing
   *  (WCAG 2.2.1: a timer-free way to reach the same content). At most four choices. */
  type Starter = { label: string; ask?: string; prefill?: string };
  const DEFAULT_STARTERS: Starter[] = Array.from(starters.querySelectorAll<HTMLButtonElement>('button')).map((b) => ({ label: b.textContent || '', ask: b.dataset.starter, prefill: b.dataset.prefill }));
  const renderStarters = () => {
    const teaser = ctx.getTeaser();
    const defaults = ctx.knownPhone ? DEFAULT_STARTERS.map((st) => ({ ...st, label: st.label.replace(/my phone/i, `my ${ctx.knownPhone}`), ask: st.ask?.replace(/my phone/i, `my ${ctx.knownPhone}`) })) : DEFAULT_STARTERS;
    const back = returningChip(hello);
    const list: Starter[] = [...(back ? [back] : []), ...(teaser?.chips ?? []).map((c) => ({ label: c.label, ask: c.ask })), ...defaults];
    const seen = new Set<string>(); starters.replaceChildren();
    input.placeholder = teaser?.asksPhone && !ctx.knownPhone ? 'e.g. Samsung A12 or Tecno Spark 10' : 'Type your question…';
    for (const st of list) {
      if (starters.childElementCount >= 4) break;
      if (seen.has(st.label.toLowerCase())) continue; seen.add(st.label.toLowerCase());
      const b = document.createElement('button'); b.type = 'button'; b.textContent = st.label;
      if (st.prefill != null) b.addEventListener('click', () => { input.value = st.prefill || ''; input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
      else b.addEventListener('click', () => { void ask(st.ask || st.label); });
      starters.append(b);
    }
  };
  const showTools = () => { if (tools) tools.hidden = !turns.some((t) => t.role === 'assistant'); };
  const opening = () => { const teaser = ctx.getTeaser(); return teaser ? welcomeTeaser(teaser.text, hello) : greetingText(); };
  const paint = () => {
    log.replaceChildren();
    for (const t of turns) bubble(t.role === 'user' ? 'user' : 'bot', t.content);
    renderStarters(); starters.hidden = turns.length > 0; clearBtn.hidden = turns.length === 0; showTools();
    if (turns.length > 0) return;
    if (greeted || ctx.reduced) { bubble('bot', opening()); greeted = true; return; }
    // First open on this page: Goldie "types" her welcome, the way a person at the counter looks up and greets you.
    greeted = true;
    const wait = typing(); starters.hidden = true;
    void Promise.all([helloP, sleep(700)]).then(() => {
      wait.row.remove(); wait.status.remove();
      if (turns.length > 0 || !log.isConnected) return;
      bubble('bot', opening()); renderStarters(); starters.hidden = false;
    });
  };

  const open = () => {
    ctx.onOpen();
    root.classList.add('gp-assistant--open'); panel.hidden = false; launch.setAttribute('aria-expanded', 'true');
    if (!ctx.reduced) { panel.classList.add('gp-assistant__panel--enter'); panel.addEventListener('animationend', () => panel.classList.remove('gp-assistant__panel--enter'), { once: true }); }
    try { sessionStorage.setItem(SEEN, '1'); } catch { /* ignore */ }
    paint(); if (!ctx.narrow()) setTimeout(() => input.focus(), 60);
  };
  const close = () => { root.classList.remove('gp-assistant--open'); panel.hidden = true; launch.setAttribute('aria-expanded', 'false'); launch.focus(); };
  // Closing folds the panel back into the launcher where the browser can morph it; opening from the launcher does the same in ShopAssistant.
  const closeMorph = () => (ctx.morph ? ctx.morph(close, false) : close());
  closeBtn.addEventListener('click', closeMorph);
  clearBtn.addEventListener('click', () => { turns = []; persist(); paint(); if (!ctx.narrow()) input.focus(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) closeMorph(); });

  const ask = async (question: string) => {
    const text = question.trim(); if (!text || busy) return;
    if (panel.hidden) open();
    busy = true; send.disabled = true; input.value = ''; starters.hidden = true; clearBtn.hidden = false;
    turns.push({ role: 'user', content: text }); bubble('user', text); persist();
    const wait = typing();
    let reply: { row: HTMLElement; el: HTMLElement } | null = null; let answer = '';
    const ensureReply = () => { if (!reply) { wait.row.remove(); reply = bubble('bot', ''); } return reply; };
    const requestId = newId();

    // Pacing: nothing shows before the "reading" pause; then the words come out at a typing pace.
    // Cards and chips wait until the sentence is written, so the reply reads in order.
    const started = performance.now();
    const pause = ctx.reduced ? 350 : readPauseMs(text);
    let shown = 0, budget = 0, streamDone = false, failed = false;
    const later: Array<() => void> = [];
    let finish: () => void = () => {};
    const revealed = new Promise<void>((resolve) => { finish = resolve; });
    const tick = () => {
      if (failed) { clearInterval(timer); finish(); return; }
      if (performance.now() - started < pause) return;
      if (shown < answer.length) {
        // A character budget per tick, spent a whole word at a time: the pace stays REVEAL_CPS and words never break.
        budget += ctx.reduced ? answer.length : revealStep(answer.length);
        let next = shown;
        for (;;) {
          const space = answer.indexOf(' ', next + 1);
          const end = space < 0 ? (streamDone ? answer.length : -1) : space;
          if (end < 0 || end - shown > budget) break;
          next = end;
          if (end === answer.length) break;
        }
        if (next === shown) return;
        budget -= next - shown; shown = next;
        const el = ensureReply().el;
        render(el, answer.slice(0, shown)); wait.status.textContent = ''; log.scrollTop = log.scrollHeight;
        return;
      }
      if (streamDone) { clearInterval(timer); for (const f of later.splice(0)) f(); finish(); }
    };
    const timer = window.setInterval(tick, 40);

    try {
      const res = await fetch(ctx.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'X-Assistant-Request-Id': requestId }, credentials: 'same-origin', body: JSON.stringify({ messages: turns.slice(-12) }) });
      if (!res.ok || !res.body) {
        let msg = "I can't reach the shop right now. Try again in a moment, or message us on WhatsApp.";
        try { msg = (await res.json()).error?.message || msg; } catch { /* keep default */ }
        failed = true; wait.row.remove(); wait.status.remove(); bubble('error', msg); turns.pop(); persist(); return;
      }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i = buf.indexOf('\n\n');
        while (i >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
          if (data) {
            let ev: Ev | null = null; try { ev = JSON.parse(data); } catch { ev = null; }
            if (ev?.type === 'text') { answer += ev.text; }
            else if (ev?.type === 'tool') { wait.status.textContent = TOOL_STATUS[ev.name] || 'checking the shop…'; }
            else if (ev?.type === 'products') { const items = ev.items; later.push(() => cards(items)); }
            else if (ev?.type === 'links') { const items = ev.items; later.push(() => chips(items)); }
            else if (ev?.type === 'error') {
              const message = ev.message;
              if (!answer) { failed = true; wait.row.remove(); wait.status.remove(); bubble('error', message); }
              else later.push(() => bubble('error', message));
            }
          }
          i = buf.indexOf('\n\n');
        }
      }
      streamDone = true;
      await revealed;
      wait.row.remove(); wait.status.remove();
      if (answer) { turns.push({ role: 'assistant', content: answer }); persist(); showTools(); } else if (reply) (reply as { row: HTMLElement }).row.remove();
    } catch {
      failed = true; clearInterval(timer);
      wait.row.remove(); wait.status.remove(); if (reply && !answer) (reply as { row: HTMLElement }).row.remove(); bubble('error', 'The connection dropped. Ask me again?');
    } finally { clearInterval(timer); busy = false; send.disabled = false; if (!ctx.narrow() || document.activeElement === input) input.focus(); }
  };

  // ---- keeping the chat, and passing it to the team
  const field = (label: string, el: HTMLInputElement | HTMLTextAreaElement) => {
    const w = document.createElement('label'); w.className = 'gp-assistant__field';
    const t = document.createElement('span'); t.textContent = label; w.append(t, el); return w;
  };
  const inputEl = (type: string, name: string, attrs: Record<string, string> = {}) => {
    const el = document.createElement('input'); el.type = type; el.name = name;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  const formCard = (title: string, build: (f: HTMLFormElement) => void, onSubmit: (f: HTMLFormElement, note: HTMLElement, btn: HTMLButtonElement) => Promise<void>, submitLabel: string) => {
    log.querySelector('.gp-assistant__formcard')?.remove();
    const row = document.createElement('div'); row.className = 'gp-assistant__row gp-assistant__row--bot gp-assistant__formcard';
    const f = document.createElement('form'); f.className = 'gp-assistant__mini'; f.noValidate = true;
    const h = document.createElement('p'); h.className = 'gp-assistant__mini-title'; h.textContent = title; f.append(h);
    build(f);
    const act = document.createElement('div'); act.className = 'gp-assistant__mini-act';
    const btn = document.createElement('button'); btn.type = 'submit'; btn.className = 'gp-assistant__add'; btn.textContent = submitLabel;
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'gp-assistant__mini-cancel'; cancel.textContent = 'Not now';
    cancel.addEventListener('click', () => row.remove());
    const note = document.createElement('p'); note.className = 'gp-assistant__add-note'; note.setAttribute('role', 'status');
    act.append(btn, cancel); f.append(act, note);
    f.addEventListener('submit', (e) => { e.preventDefault(); if (btn.disabled) return; btn.disabled = true; void onSubmit(f, note, btn).finally(() => { btn.disabled = false; }); });
    row.append(avatar(), f); log.append(row); log.scrollTop = log.scrollHeight;
    // The first field still to fill (a known name is already there), without raising the keyboard over the chat on a phone.
    const first = Array.from(f.querySelectorAll<HTMLInputElement>('input:not([type=checkbox])')).find((i) => !i.value) ?? f.querySelector('input');
    if (!ctx.narrow()) first?.focus(); else first?.scrollIntoView({ block: 'nearest' });
  };
  const postJson = async (url: string, body: unknown): Promise<{ ok: boolean; message: string }> => {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
      const j = await res.json().catch(() => null) as { success?: boolean; error?: { message?: string } } | null;
      if (res.ok && j?.success) return { ok: true, message: '' };
      return { ok: false, message: j?.error?.message || (res.status === 429 ? 'Please wait a few minutes and try again.' : 'That did not go through. Please try again.') };
    } catch { return { ok: false, message: 'The connection dropped. Please try again.' }; }
  };

  const emailForm = () => {
    if (!turns.length) return;
    ctx.track('NBA_CLICK', 'goldie-email-me');
    formCard('Where should I send this chat?', (f) => {
      f.append(field('Your email', inputEl('email', 'email', { autocomplete: 'email', inputmode: 'email', required: 'true', placeholder: 'you@example.com' })));
    }, async (f, note) => {
      const email = (f.elements.namedItem('email') as HTMLInputElement).value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { note.textContent = 'That email address does not look right.'; return; }
      note.textContent = 'Sending…';
      const r = await postJson('/api/assistant/transcript', { email, firstName: hello.firstName, turns });
      if (!r.ok) { note.textContent = r.message; return; }
      f.closest('.gp-assistant__formcard')?.remove();
      bubble('bot', `Sent to ${email}. It comes from GoldPlus in a minute or two; check spam if you don't see it.`);
    }, 'Send it');
  };

  const teamForm = () => {
    ctx.track('NBA_CLICK', 'goldie-team');
    if (!turns.some((t) => t.role === 'user')) { bubble('bot', 'Tell me first what you need, in a line or two, and I will pass the whole chat to the team.'); input.focus(); return; }
    formCard('I will pass this chat to the team. How should they reach you?', (f) => {
      f.append(field('Your name', inputEl('text', 'name', { autocomplete: 'given-name', value: hello.firstName ?? '' })));
      f.append(field('Phone or WhatsApp', inputEl('tel', 'phone', { autocomplete: 'tel', inputmode: 'tel', placeholder: '07…' })));
      f.append(field('Email (the team can reply by email)', inputEl('email', 'email', { autocomplete: 'email', inputmode: 'email' })));
      const ta = document.createElement('textarea'); ta.name = 'note'; ta.rows = 2; ta.maxLength = 500;
      f.append(field('Anything to add? (optional)', ta));
      const copy = document.createElement('label'); copy.className = 'gp-assistant__check';
      const cb = inputEl('checkbox', 'copy'); cb.checked = true;
      const ct = document.createElement('span'); ct.textContent = 'Email me a copy too';
      copy.append(cb, ct); f.append(copy);
    }, async (f, note) => {
      const v = (n: string) => ((f.elements.namedItem(n) as HTMLInputElement | null)?.value ?? '').trim();
      const name = v('name'), phone = v('phone'), email = v('email'), extra = v('note');
      if (!phone && !email) { note.textContent = 'Give a phone number or an email so the team can reply.'; return; }
      note.textContent = 'Passing it on…';
      const sendCopy = (f.elements.namedItem('copy') as HTMLInputElement).checked;
      const r = await postJson('/api/assistant/handover', { name, phone, email, note: extra, sendCopy, turns });
      if (!r.ok) { note.textContent = r.message; return; }
      f.closest('.gp-assistant__formcard')?.remove();
      const how = phone ? `on ${phone}` : `by email at ${email}`;
      bubble('bot', `Done${name ? `, ${name.split(/\s+/)[0]}` : ''}. The team has the whole chat and will get back to you ${how}.${email && sendCopy ? ' A copy is on its way to your email.' : ''} For anything urgent, WhatsApp is quickest.`);
      ctx.track('NBA_CLICK', 'goldie-team-sent');
    }, 'Send to the team');
  };

  const saveChat = async () => {
    if (!turns.length) return;
    ctx.track('NBA_CLICK', 'goldie-save');
    const text = transcriptText(turns);
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string }) => Promise<void> };
    // On a phone the share sheet is the clever path: save it to notes, send it to yourself on WhatsApp, or screenshot from there.
    if (ctx.narrow() && typeof nav.share === 'function') {
      try { await nav.share({ title: 'My chat with Goldie', text }); return; } catch (e) { if ((e as DOMException)?.name === 'AbortError') return; }
    }
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = `goldplus-chat-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      try { await navigator.clipboard.writeText(text); bubble('bot', 'Copied. Paste it anywhere you like to keep it.'); } catch { /* nothing else to try */ }
    }
  };

  tools?.querySelector('[data-tool="email"]')?.addEventListener('click', emailForm);
  tools?.querySelector('[data-tool="save"]')?.addEventListener('click', () => { void saveChat(); });
  tools?.querySelector('[data-tool="team"]')?.addEventListener('click', teamForm);

  form.addEventListener('submit', (e) => { e.preventDefault(); void ask(input.value); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(input.value); } });
  renderStarters();
  return { open, close, ask, isOpen: () => !panel.hidden };
}
