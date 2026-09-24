/**
 * The /bulk page's browser behaviour (docs/bulk-buying/DESIGN.md).
 *
 * Reads the server-rendered rows as the catalogue, keeps the list in
 * localStorage, and drives the two honest routes: the basket (through
 * /api/bulk/cart) and a quote request (through /api/bulk/quote). All state
 * logic is in lib/bulkList (pure, unit-tested); this file is DOM only.
 * Every string that came from data is set with textContent, never as HTML.
 */
import {
  BULK_STORAGE_KEY,
  CART_LINE_QUANTITY_CAP,
  CART_MAX_DISTINCT_LINES,
  MAX_BULK_LINE_QUANTITY,
  buildCodeIndex,
  clampQuantity,
  emptyState,
  estimate,
  idempotencyKeyFor,
  parsePaste,
  parseStoredState,
  pasteMissMessage,
  quantityOf,
  removeLine,
  serializeState,
  setLine,
  splitForCart,
  submissionFingerprint,
  type BulkListState,
  type CatalogueItem,
} from './bulkList';
import { formatUgx } from './money';
import { isValidEmail, isValidUgandanPhone } from './formValidation';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function mintKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '');
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function initBulkBuilder(): void {
  const root = document.getElementById('bulk-root');
  const rowsList = document.getElementById('bulk-rows');
  if (!root || !rowsList) return;

  const rows = Array.from(rowsList.querySelectorAll<HTMLLIElement>('[data-bulk-row]'));
  const catalogue = new Map<string, CatalogueItem>();
  const rowById = new Map<string, HTMLLIElement>();
  for (const row of rows) {
    const d = row.dataset;
    const id = (d.id ?? '').toLowerCase();
    if (!id) continue;
    const price = Number(d.price);
    catalogue.set(id, {
      productId: id,
      name: d.name ?? '',
      code: d.code || null,
      sku: d.sku || null,
      modelNumber: d.model || null,
      unitPriceUgx: d.price && Number.isFinite(price) && price > 0 ? price : null,
      inStock: d.instock === '1',
    });
    rowById.set(id, row);
  }
  const codeIndex = buildCodeIndex(catalogue.values());
  /** Ids the server said are no longer on sale (a submit refused them). */
  const refusedIds = new Set<string>();

  // ---------------------------------------------------------------- storage
  const load = (): BulkListState => {
    try {
      return parseStoredState(window.localStorage.getItem(BULK_STORAGE_KEY));
    } catch {
      return emptyState();
    }
  };
  let state = load();
  const save = () => {
    try {
      window.localStorage.setItem(BULK_STORAGE_KEY, serializeState(state));
    } catch {
      /* private mode or full storage: the list still works for this visit */
    }
  };

  // Another tab changed the list: follow it.
  window.addEventListener('storage', (event) => {
    if (event.key !== BULK_STORAGE_KEY) return;
    state = load();
    syncRowInputs();
    renderReview();
  });

  const live = document.getElementById('bulk-live');
  const announce = (message: string) => {
    if (!live) return;
    live.textContent = '';
    window.setTimeout(() => { live.textContent = message; }, 50);
  };

  // ---------------------------------------------------------------- rows
  const qtyInputOf = (row: HTMLElement) => row.querySelector<HTMLInputElement>('[data-qty]');

  function syncRowInputs(): void {
    for (const [id, row] of rowById) {
      const input = qtyInputOf(row);
      if (!input || document.activeElement === input) continue;
      const q = quantityOf(state, id);
      input.value = q > 0 ? String(q) : '';
      row.classList.toggle('bg-lime-50', q > 0);
    }
  }

  function commitRow(id: string, value: number, announceChange: boolean): void {
    const item = catalogue.get(id);
    if (!item) return;
    const before = quantityOf(state, id);
    state = setLine(state, { productId: id, name: item.name, code: item.code }, value);
    save();
    const after = quantityOf(state, id);
    const row = rowById.get(id);
    if (row) row.classList.toggle('bg-lime-50', after > 0);
    renderReview();
    if (announceChange && before !== after) {
      announce(after > 0 ? `${item.name}: ${after} in your list.` : `${item.name} removed from your list.`);
    }
  }

  rowsList.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.matches('[data-qty]')) return;
    const digits = input.value.replace(/\D/g, '').slice(0, 6);
    if (digits !== input.value) input.value = digits;
    const row = input.closest<HTMLElement>('[data-bulk-row]');
    const id = row?.dataset.id?.toLowerCase();
    if (!id) return;
    const n = digits ? Number(digits) : 0;
    if (n > MAX_BULK_LINE_QUANTITY) input.value = String(MAX_BULK_LINE_QUANTITY);
    commitRow(id, Math.min(n, MAX_BULK_LINE_QUANTITY), false);
  });
  rowsList.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.matches('[data-qty]')) return;
    const id = input.closest<HTMLElement>('[data-bulk-row]')?.dataset.id?.toLowerCase();
    if (!id) return;
    const q = quantityOf(state, id);
    input.value = q > 0 ? String(q) : '';
    const item = catalogue.get(id);
    if (item) announce(q > 0 ? `${item.name}: ${q} in your list.` : `${item.name} is not in your list.`);
  });
  rowsList.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-step]');
    if (!button) return;
    const row = button.closest<HTMLElement>('[data-bulk-row]');
    const id = row?.dataset.id?.toLowerCase();
    if (!row || !id) return;
    const step = Number(button.dataset.step) || 0;
    const next = Math.max(0, Math.min(MAX_BULK_LINE_QUANTITY, quantityOf(state, id) + step));
    commitRow(id, next, true);
    const input = qtyInputOf(row);
    if (input) input.value = next > 0 ? String(next) : '';
  });

  // ---------------------------------------------------------------- filters
  const search = document.getElementById('bulk-search') as HTMLInputElement | null;
  const cat = document.getElementById('bulk-cat') as HTMLSelectElement | null;
  const sub = document.getElementById('bulk-sub') as HTMLSelectElement | null;
  const onlyList = document.getElementById('bulk-only-list') as HTMLInputElement | null;
  const count = document.getElementById('bulk-count');
  const emptyFilter = document.getElementById('bulk-empty-filter');
  let groups: Array<{ slug: string; subs: Array<{ slug: string; name: string; count: number }> }> = [];
  try {
    groups = JSON.parse(root.dataset.groups ?? '[]');
  } catch {
    groups = [];
  }

  function fillSubcategories(): void {
    if (!sub || !cat) return;
    sub.textContent = '';
    sub.append(new Option('All types', ''));
    const group = groups.find((g) => g.slug === cat.value);
    for (const s of group?.subs ?? []) sub.append(new Option(`${s.name} (${s.count})`, s.slug));
    sub.disabled = !group || group.subs.length === 0;
  }

  function applyFilters(): void {
    const terms = (search?.value ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const compactTerms = terms.map((t) => t.replace(/[^a-z0-9]/g, '')).filter(Boolean);
    const category = cat?.value ?? '';
    const subcategory = sub?.value ?? '';
    const mine = onlyList?.checked ?? false;
    let shown = 0;
    for (const [id, row] of rowById) {
      const d = row.dataset;
      const hay = d.search ?? '';
      const compact = hay.replace(/[^a-z0-9]/g, '');
      const matches =
        (!category || d.cat === category) &&
        (!subcategory || d.sub === subcategory) &&
        (!mine || quantityOf(state, id) > 0) &&
        terms.every((t, i) => hay.includes(t) || (compactTerms[i] ? compact.includes(compactTerms[i]) : false));
      row.hidden = !matches;
      if (matches) shown += 1;
    }
    if (count) count.textContent = `Showing ${plural(shown, 'product', 'products')}`;
    if (emptyFilter) emptyFilter.hidden = shown > 0;
  }

  let searchTimer = 0;
  search?.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(applyFilters, 120);
  });
  cat?.addEventListener('change', () => { fillSubcategories(); applyFilters(); });
  sub?.addEventListener('change', applyFilters);
  onlyList?.addEventListener('change', applyFilters);

  // ---------------------------------------------------------------- review
  const linesList = document.getElementById('bulk-lines');
  const summary = document.getElementById('bulk-summary');
  const estimateBox = document.getElementById('bulk-estimate');
  const estimateTotal = document.getElementById('bulk-estimate-total');
  const estimateUnpriced = document.getElementById('bulk-estimate-unpriced');
  const clearButton = document.getElementById('bulk-clear') as HTMLButtonElement | null;
  const addCartButton = document.getElementById('bulk-add-cart') as HTMLButtonElement | null;
  const quoteSubmit = document.getElementById('bulk-quote-submit') as HTMLButtonElement | null;
  const barText = document.getElementById('bulk-bar-text');

  const isListed = (id: string) => catalogue.has(id) && !refusedIds.has(id);

  function renderReview(): void {
    const listedCatalogue = new Map([...catalogue].filter(([id]) => !refusedIds.has(id)));
    const est = estimate(state, listedCatalogue);

    if (summary) {
      summary.textContent = est.lineCount === 0
        ? 'No products yet. Type a quantity next to any product.'
        : `${plural(est.lineCount, 'product', 'products')}, ${plural(est.totalUnits, 'unit', 'units')}.`;
    }
    if (barText) {
      barText.textContent = '';
      if (est.lineCount === 0) barText.append(el('span', 'font-bold', 'Your list is empty'));
      else {
        barText.append(el('span', 'font-bold', `${plural(est.lineCount, 'product', 'products')} · ${plural(est.totalUnits, 'unit', 'units')}`));
        barText.append(el('span', 'block text-xs text-slate-600', `About ${formatUgx(est.estimatedTotalUgx)} at list price`));
      }
    }
    if (estimateBox) estimateBox.hidden = est.lineCount === 0;
    if (estimateTotal) estimateTotal.textContent = formatUgx(est.estimatedTotalUgx);
    if (estimateUnpriced) {
      const unpriced = est.unpricedLineCount;
      estimateUnpriced.hidden = unpriced === 0;
      estimateUnpriced.textContent = unpriced > 0
        ? `${plural(unpriced, 'product has', 'products have')} no listed price and ${unpriced === 1 ? 'is' : 'are'} not in the estimate. Our team will price ${unpriced === 1 ? 'it' : 'them'}.`
        : '';
    }
    if (clearButton) clearButton.hidden = est.lineCount === 0;
    const { cartable } = splitForCart(state, listedCatalogue);
    if (addCartButton) {
      addCartButton.disabled = cartable.length === 0;
      addCartButton.textContent = cartable.length === 0
        ? 'Add to basket'
        : `Add ${plural(Math.min(cartable.length, CART_MAX_DISTINCT_LINES), 'product', 'products')} to basket`;
    }
    if (quoteSubmit) {
      quoteSubmit.textContent = est.lineCount === 0 ? 'Send quote request' : `Send quote request (${plural(est.lineCount, 'product', 'products')})`;
    }

    if (!linesList) return;
    linesList.textContent = '';
    for (const line of state.lines) {
      const item = catalogue.get(line.productId);
      const listed = isListed(line.productId);
      const li = el('li', 'py-3');
      const top = el('div', 'flex items-start justify-between gap-2');
      const info = el('div', 'min-w-0');
      info.append(el('p', 'break-words text-sm font-bold text-gray-950', item?.name ?? line.name ?? 'Product'));
      const meta = el('p', 'text-xs text-slate-600');
      const code = item?.code ?? line.code;
      if (code) meta.append(el('span', 'font-mono', code), document.createTextNode(' · '));
      if (!listed) {
        meta.append(el('span', 'font-bold text-red-700', 'No longer on sale. Remove it to send your list.'));
      } else {
        const price = item?.unitPriceUgx ?? null;
        meta.append(document.createTextNode(price === null ? 'Price on request' : `${formatUgx(price)} each`));
        if (line.quantity > CART_LINE_QUANTITY_CAP) meta.append(document.createTextNode(` · over ${CART_LINE_QUANTITY_CAP}: quote only`));
      }
      info.append(meta);
      const remove = el('button', 'min-h-11 shrink-0 rounded-full px-3 text-xs font-bold text-slate-700 underline underline-offset-4 outline-none hover:text-gray-950 focus-visible:ring-2 focus-visible:ring-brand-primaryInk', 'Remove');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${item?.name ?? line.name ?? 'product'} from your list`);
      remove.addEventListener('click', () => {
        const name = item?.name ?? line.name ?? 'Product';
        state = removeLine(state, line.productId);
        save();
        syncRowInputs();
        renderReview();
        applyFilters();
        announce(`${name} removed from your list.`);
        document.getElementById('bulk-review')?.focus();
      });
      top.append(info, remove);
      li.append(top);

      if (listed) {
        const qtyWrap = el('div', 'mt-2 flex items-center gap-2');
        const inputId = `bulk-line-${line.productId}`;
        const label = el('label', 'text-xs font-bold text-slate-700', 'Quantity');
        label.htmlFor = inputId;
        const input = el('input', 'h-11 w-24 rounded-xl border border-slate-300 px-2 text-center text-base font-bold outline-none focus-visible:border-slate-900 focus-visible:ring-2 focus-visible:ring-brand-primaryInk');
        input.id = inputId;
        input.type = 'text';
        input.inputMode = 'numeric';
        input.maxLength = 6;
        input.value = String(line.quantity);
        input.autocomplete = 'off';
        input.addEventListener('change', () => {
          const q = clampQuantity(input.value.replace(/\D/g, '')) ?? 0;
          commitRow(line.productId, q, true);
          syncRowInputs();
        });
        const lineTotal = item?.unitPriceUgx ? el('span', 'ml-auto text-sm text-slate-800', formatUgx(item.unitPriceUgx * line.quantity)) : null;
        qtyWrap.append(label, input);
        if (lineTotal) qtyWrap.append(lineTotal);
        li.append(qtyWrap);
      }
      linesList.append(li);
    }
  }

  clearButton?.addEventListener('click', () => {
    if (!window.confirm('Clear every product from your bulk list?')) return;
    state = emptyState();
    save();
    syncRowInputs();
    renderReview();
    applyFilters();
    announce('Your bulk list is empty.');
  });

  // ---------------------------------------------------------------- paste
  const pasteBox = document.getElementById('bulk-paste') as HTMLTextAreaElement | null;
  const pasteResult = document.getElementById('bulk-paste-result');
  document.getElementById('bulk-paste-add')?.addEventListener('click', () => {
    if (!pasteBox || !pasteResult) return;
    const { matches, misses } = parsePaste(pasteBox.value, codeIndex);
    for (const m of matches) {
      const item = catalogue.get(m.productId);
      if (!item) continue;
      state = setLine(state, { productId: m.productId, name: item.name, code: item.code }, quantityOf(state, m.productId) + m.quantity);
    }
    save();
    syncRowInputs();
    renderReview();
    applyFilters();

    pasteResult.textContent = '';
    if (matches.length === 0 && misses.length === 0) {
      pasteResult.append(el('p', 'text-slate-700', 'Paste at least one line, for example GP-C08, 50.'));
      return;
    }
    if (matches.length > 0) pasteResult.append(el('p', 'font-bold text-green-800', `Added ${plural(matches.length, 'product', 'products')} to your list.`));
    if (misses.length > 0) {
      pasteResult.append(el('p', 'mt-2 font-bold text-red-700', `${plural(misses.length, 'line', 'lines')} could not be added:`));
      const ul = el('ul', 'mt-1 list-disc space-y-1 pl-5 text-slate-800');
      for (const miss of misses) {
        const li = el('li');
        li.append(el('span', 'font-mono', miss.source), document.createTextNode(`: ${pasteMissMessage(miss.reason)}`));
        ul.append(li);
      }
      pasteResult.append(ul);
    }
    // Keep only the lines that did not match, so the buyer can fix them in place.
    pasteBox.value = misses.map((m) => m.source).join('\n');
  });

  // ---------------------------------------------------------------- basket
  const cartResult = document.getElementById('bulk-cart-result');
  addCartButton?.addEventListener('click', async () => {
    if (!cartResult) return;
    const listedCatalogue = new Map([...catalogue].filter(([id]) => !refusedIds.has(id)));
    const { cartable, overCap } = splitForCart(state, listedCatalogue);
    const batch = cartable.slice(0, CART_MAX_DISTINCT_LINES);
    const leftOver = cartable.slice(CART_MAX_DISTINCT_LINES);
    if (batch.length === 0) return;
    addCartButton.disabled = true;
    const label = addCartButton.textContent;
    addCartButton.textContent = 'Adding to basket…';
    cartResult.textContent = '';
    try {
      const res = await fetch('/api/bulk/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ lines: batch.map((l) => ({ productId: l.productId, quantity: l.quantity })) }),
      });
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: { results?: Array<{ productId: string; outcome: string; message?: string }>; addedCount?: number }; error?: { message?: string } }
        | null;
      if (res.status === 429) {
        cartResult.append(el('p', 'font-bold text-red-700', 'You have tried several times in a short while. Wait a few minutes and try again.'));
      } else if (!json?.success || !json.data) {
        cartResult.append(el('p', 'font-bold text-red-700', json?.error?.message ?? 'We could not reach your basket. Try again in a minute.'));
      } else {
        const results = json.data.results ?? [];
        const added = results.filter((r) => r.outcome === 'added').length;
        if (added > 0) {
          const p = el('p', 'font-bold text-green-800', `Added ${plural(added, 'product', 'products')} to your basket. `);
          const link = el('a', 'underline underline-offset-4', 'Go to basket');
          link.href = '/cart';
          p.append(link);
          cartResult.append(p);
          cartResult.append(el('p', 'mt-1 text-slate-700', 'They are still in this list too. Remove them here if you do not need a quote for them.'));
        }
        const problems = results.filter((r) => r.outcome !== 'added');
        if (problems.length > 0) {
          cartResult.append(el('p', 'mt-2 font-bold text-red-700', `${plural(problems.length, 'product was', 'products were')} not added:`));
          const ul = el('ul', 'mt-1 list-disc space-y-1 pl-5 text-slate-800');
          for (const r of problems) ul.append(el('li', undefined, `${catalogue.get(r.productId)?.name ?? 'A product'}: ${r.message ?? 'not added'}`));
          cartResult.append(ul);
        }
        announce(added > 0 ? `Added ${plural(added, 'product', 'products')} to your basket.` : 'Nothing was added to your basket.');
      }
    } catch {
      cartResult.append(el('p', 'font-bold text-red-700', 'We could not reach your basket. Check your connection and try again.'));
    } finally {
      addCartButton.disabled = false;
      addCartButton.textContent = label;
    }
    if (overCap.length > 0) {
      cartResult.append(el('p', 'mt-2 text-slate-700', `${plural(overCap.length, 'product is', 'products are')} over ${CART_LINE_QUANTITY_CAP}, the basket's limit for one product. Send ${overCap.length === 1 ? 'it' : 'them'} as a quote request below.`));
    }
    if (leftOver.length > 0) {
      cartResult.append(el('p', 'mt-2 text-slate-700', `The basket holds up to ${CART_MAX_DISTINCT_LINES} different products, so ${plural(leftOver.length, 'product was', 'products were')} not sent. Send the rest as a quote request.`));
    }
  });

  // ---------------------------------------------------------------- quote
  const form = document.getElementById('bulk-quote-form') as HTMLFormElement | null;
  const formError = document.getElementById('bulk-form-error');

  const fieldIds: Record<string, string> = {
    customerName: 'bq-name',
    businessName: 'bq-business',
    phone: 'bq-phone',
    email: 'bq-email',
    deliveryDistrict: 'bq-district',
    neededBy: 'bq-needed',
    notes: 'bq-notes',
  };

  function clearFieldErrors(): void {
    form?.querySelectorAll('[data-field-error]').forEach((n) => n.remove());
    form?.querySelectorAll('[aria-invalid="true"]').forEach((n) => {
      n.removeAttribute('aria-invalid');
      n.removeAttribute('aria-describedby');
    });
    if (formError) formError.textContent = '';
  }

  function fieldError(field: string, message: string): void {
    const input = document.getElementById(fieldIds[field] ?? '');
    if (!input) return;
    const id = `${input.id}-error`;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', id);
    const p = el('p', 'mt-1 text-xs font-bold text-red-700', message);
    p.id = id;
    p.dataset.fieldError = '1';
    input.insertAdjacentElement('afterend', p);
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors();
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? '').trim();
    const errors: Array<[string, string]> = [];
    if (value('customerName').length < 2) errors.push(['customerName', 'Enter your name.']);
    if (!isValidUgandanPhone(value('phone'))) errors.push(['phone', 'Enter a Ugandan phone number, for example 0772 123 456.']);
    if (value('email') && !isValidEmail(value('email'))) errors.push(['email', 'Check the email, or leave it blank.']);

    if (state.lines.length === 0) {
      if (formError) formError.textContent = 'Your list is empty. Type a quantity next to at least one product.';
      return;
    }
    const unlisted = state.lines.filter((l) => !isListed(l.productId));
    if (unlisted.length > 0) {
      if (formError) formError.textContent = `Remove ${plural(unlisted.length, 'product that is', 'products that are')} no longer on sale, then send your list.`;
      document.getElementById('bulk-review-heading')?.scrollIntoView({ block: 'start' });
      return;
    }
    if (errors.length > 0) {
      for (const [field, message] of errors) fieldError(field, message);
      if (formError) formError.textContent = errors.length === 1 ? 'Check the highlighted field.' : `Check the ${errors.length} highlighted fields.`;
      document.getElementById(fieldIds[errors[0][0]])?.focus();
      return;
    }

    const lines = state.lines.map((l) => ({ productId: l.productId, quantity: l.quantity }));
    const keyed = idempotencyKeyFor(state, submissionFingerprint(value('phone'), lines), mintKey);
    state = keyed.state;
    save();

    const submit = quoteSubmit;
    const label = submit?.textContent ?? '';
    if (submit) { submit.disabled = true; submit.textContent = 'Sending your list…'; }
    try {
      const res = await fetch('/api/bulk/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          idempotencyKey: keyed.key,
          customerName: value('customerName'),
          businessName: value('businessName'),
          phone: value('phone'),
          email: value('email'),
          buyerType: value('buyerType') || 'retail',
          deliveryDistrict: value('deliveryDistrict'),
          neededBy: value('neededBy'),
          notes: value('notes'),
          lines,
        }),
      });
      if (res.status === 429) {
        if (formError) formError.textContent = 'You have sent several requests in a short while. Wait a few minutes and try again. Your list is saved.';
        return;
      }
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: { code?: string; message?: string; details?: { productIds?: string[]; field?: string } } }
        | null;
      if (json?.success) {
        state = emptyState();
        save();
        window.location.assign('/bulk/submitted');
        return;
      }
      const code = json?.error?.code;
      const message = json?.error?.message ?? 'We could not send your list just now. It is saved on this device. Try again in a minute.';
      if (code === 'PRODUCTS_UNAVAILABLE') {
        for (const id of json?.error?.details?.productIds ?? []) refusedIds.add(String(id).toLowerCase());
        renderReview();
      }
      if (code === 'IDEMPOTENCY_CONFLICT') {
        state = { ...state, pending: null };
        save();
      }
      const field = json?.error?.details?.field;
      if (field && fieldIds[field]) {
        fieldError(field, message);
        document.getElementById(fieldIds[field])?.focus();
      }
      if (formError) formError.textContent = message;
    } catch {
      if (formError) formError.textContent = 'We could not reach our sales system. Your list is saved on this device. Check your connection and try again.';
    } finally {
      if (submit) { submit.disabled = false; submit.textContent = label; }
    }
  });

  // ---------------------------------------------------------------- start
  syncRowInputs();
  fillSubcategories();
  renderReview();
  applyFilters();
}
