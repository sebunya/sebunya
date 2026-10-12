/**
 * Goldie's panel: loaded on the first open (dynamic import from
 * ShopAssistant.astro), so every page carries only the launcher and this
 * file's cost is paid by the shopper who actually opens the chat (mandate §7:
 * no assistant bundle on every page before it is needed).
 *
 * The browser posts the conversation to /api/assistant/chat and renders the
 * streamed events; product cards and action chips come from the validated
 * `products` and `links` events, never from the model's prose. The transcript
 * lives in sessionStorage for this tab only; the server stores nothing.
 */
type Turn = { role: 'user' | 'assistant'; content: string };
type Card = { name: string; url: string; sku: string | null; price_ugx: number | null; availability: string; image: string | null; note?: string };
type Chip = { label: string; url: string };
type Ev = { type: 'text'; text: string } | { type: 'tool'; name: string } | { type: 'products'; items: Card[] } | { type: 'links'; items: Chip[] } | { type: 'done' } | { type: 'error'; code: string; message: string };


export function mountGoldie(root: HTMLElement): { open: () => void; close: () => void } {

  const endpoint = root.dataset.endpoint || '/api/assistant/chat';
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const launch = q<HTMLButtonElement>('[data-launch]'), panel = q<HTMLElement>('[data-panel]'), closeBtn = q<HTMLButtonElement>('[data-close]');
  const clearBtn = q<HTMLButtonElement>('[data-clear]'), log = q<HTMLElement>('[data-log]'), starters = q<HTMLElement>('[data-starters]');
  const form = q<HTMLFormElement>('[data-form]'), input = q<HTMLTextAreaElement>('[data-input]'), send = q<HTMLButtonElement>('[data-send]');
  const KEY = 'gp-assistant-turns', SEEN = 'gp-assistant-seen';
  const SITE = location.origin;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let turns: Turn[] = [];
  let busy = false;

  try { const saved = sessionStorage.getItem(KEY); if (saved) turns = JSON.parse(saved); } catch { turns = []; }
  const persist = () => { try { sessionStorage.setItem(KEY, JSON.stringify(turns.slice(-12))); } catch { /* private mode or blocked storage */ } };
  const ugx = (n: number | null) => (n == null ? 'Price on request' : `UGX ${n.toLocaleString('en-UG')}`);
  const AVAIL: Record<string, string> = { in_stock: 'In stock', low_stock: 'Low stock', out_of_stock: 'Out of stock', pre_order: 'Pre-order' };
  const TOOL_STATUS: Record<string, string> = {
    search_products: 'checking the shelf…', get_product: 'reading the product page…', list_categories: 'checking the categories…',
    find_battery: 'running the battery finder…', store_info: 'checking the shop details…',
  };
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
  const hour = new Date().getHours();
  const GREETING = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, I'm Goldie from GoldPlus. Ask me about a charger, a cable, a power bank, earphones or a battery for your phone, and I'll check the shelf for you.`;

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
  const avatar = () => { const a = document.createElement('span'); a.className = 'gp-assistant__avatar gp-assistant__avatar--sm'; a.setAttribute('aria-hidden', 'true'); a.textContent = 'G'; return a; };
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
      const ok = it.url.startsWith(SITE + '/') || /^https:\/\/(wa\.me|maps\.google\.com|www\.google\.com\/maps|goo\.gl\/maps|maps\.app\.goo\.gl)\//.test(it.url);
      if (!ok) continue;
      const a = document.createElement('a'); a.className = 'gp-assistant__chip'; a.href = it.url; a.textContent = it.label;
      if (!it.url.startsWith(SITE)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      wrap.append(a);
    }
    if (wrap.childElementCount) { log.append(wrap); log.scrollTop = log.scrollHeight; }
  };
  const cards = (items: Card[]) => {
    const wrap = document.createElement('div'); wrap.className = 'gp-assistant__cards';
    for (const it of items) {
      if (!it.url.startsWith(SITE + '/')) continue;
      const card = document.createElement('a'); card.className = 'gp-assistant__card'; card.href = it.url;
      if (it.image) { const img = document.createElement('img'); img.src = it.image; img.alt = ''; img.loading = 'lazy'; card.append(img); } else { const ph = document.createElement('div'); ph.className = 'ph'; card.append(ph); }
      const body = document.createElement('div');
      const b = document.createElement('b'); b.textContent = it.name; body.append(b);
      const p = document.createElement('span'); p.className = 'price'; p.textContent = ugx(it.price_ugx); body.append(p);
      const m = document.createElement('span'); m.className = `meta${it.availability === 'in_stock' ? ' meta--in' : ''}`; m.textContent = `${AVAIL[it.availability] ?? it.availability}${it.note ? ` · ${it.note}` : ''}`; body.append(m);
      card.append(body); wrap.append(card);
    }
    if (wrap.childElementCount) { log.append(wrap); log.scrollTop = log.scrollHeight; }
  };
  const paint = () => {
    log.replaceChildren();
    if (turns.length === 0) bubble('bot', GREETING);
    for (const t of turns) bubble(t.role === 'user' ? 'user' : 'bot', t.content);
    starters.hidden = turns.length > 0; clearBtn.hidden = turns.length === 0;
  };

  const open = () => {
    root.classList.add('gp-assistant--open'); panel.hidden = false; launch.setAttribute('aria-expanded', 'true');
    if (!reduced) { panel.classList.add('gp-assistant__panel--enter'); panel.addEventListener('animationend', () => panel.classList.remove('gp-assistant__panel--enter'), { once: true }); }
    try { sessionStorage.setItem(SEEN, '1'); } catch { /* ignore */ }
    paint(); setTimeout(() => input.focus(), 60);
  };
  const close = () => { root.classList.remove('gp-assistant--open'); panel.hidden = true; launch.setAttribute('aria-expanded', 'false'); launch.focus(); };
  closeBtn.addEventListener('click', close);
  clearBtn.addEventListener('click', () => { turns = []; persist(); paint(); input.focus(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(); });

  const ask = async (question: string) => {
    const text = question.trim(); if (!text || busy) return;
    busy = true; send.disabled = true; input.value = ''; starters.hidden = true; clearBtn.hidden = false;
    turns.push({ role: 'user', content: text }); bubble('user', text); persist();
    const wait = typing();
    let reply: { row: HTMLElement; el: HTMLElement } | null = null; let answer = '';
    const ensureReply = () => { if (!reply) { wait.row.remove(); reply = bubble('bot', ''); } return reply; };
    const requestId = newId();
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'X-Assistant-Request-Id': requestId }, credentials: 'same-origin', body: JSON.stringify({ messages: turns.slice(-12) }) });
      if (!res.ok || !res.body) {
        let msg = "I can't reach the shop right now. Try again in a moment, or message us on WhatsApp.";
        try { msg = (await res.json()).error?.message || msg; } catch { /* keep default */ }
        wait.row.remove(); wait.status.remove(); bubble('error', msg); turns.pop(); persist(); return;
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
            if (ev?.type === 'text') { answer += ev.text; render(ensureReply().el, answer); wait.status.textContent = ''; log.scrollTop = log.scrollHeight; }
            else if (ev?.type === 'tool') { wait.status.textContent = TOOL_STATUS[ev.name] || 'checking the shop…'; }
            else if (ev?.type === 'products') { wait.status.textContent = ''; cards(ev.items); }
            else if (ev?.type === 'links') { chips(ev.items); }
            else if (ev?.type === 'error') { wait.row.remove(); wait.status.remove(); if (reply && !answer) (reply as { row: HTMLElement }).row.remove(); bubble('error', ev.message); }
          }
          i = buf.indexOf('\n\n');
        }
      }
      wait.row.remove(); wait.status.remove();
      if (answer) { turns.push({ role: 'assistant', content: answer }); persist(); } else if (reply) (reply as { row: HTMLElement }).row.remove();
    } catch {
      wait.row.remove(); wait.status.remove(); if (reply && !answer) (reply as { row: HTMLElement }).row.remove(); bubble('error', 'The connection dropped. Ask me again?');
    } finally { busy = false; send.disabled = false; input.focus(); }
  };

  form.addEventListener('submit', (e) => { e.preventDefault(); void ask(input.value); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(input.value); } });
  starters.querySelectorAll<HTMLButtonElement>('[data-starter]').forEach((b) => b.addEventListener('click', () => { open(); void ask(b.dataset.starter || ''); }));
  starters.querySelectorAll<HTMLButtonElement>('[data-prefill]').forEach((b) => b.addEventListener('click', () => { open(); input.value = b.dataset.prefill || ''; input.focus(); input.setSelectionRange(input.value.length, input.value.length); }));
  return { open, close };
  }
