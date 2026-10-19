/**
 * The /bulk page's browser behaviour (docs/bulk-buying/DESIGN.md §12).
 *
 * Reads the server-rendered rows as the catalogue, keeps the list and budget
 * in localStorage, unlocks bulk prices with a texted code (/api/bulk/access/*),
 * and sends the request (/api/bulk/quote). All state logic is in lib/bulkList
 * (pure, unit-tested); this file is DOM only. Every string that came from data
 * is set with textContent, never as HTML.
 */
import {
  BULK_STORAGE_KEY,
  SELF_SERVE_MAX_CARTONS,
  budgetStatus,
  buildCodeIndex,
  clampCount,
  countLabel,
  countOf,
  emptyState,
  estimate,
  idempotencyKeyFor,
  maxCountFor,
  parsePaste,
  parseStoredState,
  pasteMissMessage,
  removeLine,
  serializeState,
  setBudget,
  setLine,
  submissionFingerprint,
  type BulkListState,
  type BulkUnit,
  type CatalogueItem,
} from './bulkList';
import { formatUgx } from './money';
import { isValidUgandanPhone } from './formValidation';

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

  const unlocked = root.dataset.unlocked === '1';
  const rows = Array.from(rowsList.querySelectorAll<HTMLLIElement>('[data-bulk-row]'));
  const catalogue = new Map<string, CatalogueItem>();
  const rowById = new Map<string, HTMLLIElement>();
  for (const row of rows) {
    const d = row.dataset;
    const id = (d.id ?? '').toLowerCase();
    if (!id) continue;
    const price = Number(d.price);
    const perCarton = Number(d.perCarton);
    const bulkUnit: BulkUnit = d.unit === 'piece' ? 'piece' : 'carton';
    catalogue.set(id, {
      productId: id,
      name: d.name ?? '',
      code: d.code || null,
      sku: d.sku || null,
      modelNumber: d.model || null,
      bulkUnit,
      unitsPerCarton: bulkUnit === 'carton' && d.perCarton && Number.isInteger(perCarton) && perCarton > 1 ? perCarton : null,
      bulkPriceUgx: d.price && Number.isFinite(price) && price > 0 ? price : null,
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
      const q = countOf(state, id);
      input.value = q > 0 ? String(q) : '';
      row.classList.toggle('bg-lime-50', q > 0);
    }
  }

  function commitRow(id: string, value: number, announceChange: boolean): void {
    const item = catalogue.get(id);
    if (!item) return;
    const before = countOf(state, id);
    state = setLine(state, item, value);
    save();
    const after = countOf(state, id);
    const row = rowById.get(id);
    if (row) row.classList.toggle('bg-lime-50', after > 0);
    renderReview();
    if (announceChange && before !== after) {
      announce(after > 0 ? `${item.name}: ${countLabel(item, after)} in your list.` : `${item.name} removed from your list.`);
    }
  }

  rowsList.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.matches('[data-qty]')) return;
    const digits = input.value.replace(/\D/g, '').slice(0, 5);
    if (digits !== input.value) input.value = digits;
    const row = input.closest<HTMLElement>('[data-bulk-row]');
    const id = row?.dataset.id?.toLowerCase();
    const item = id ? catalogue.get(id) : undefined;
    if (!id || !item) return;
    const max = maxCountFor(item.bulkUnit);
    const n = digits ? Number(digits) : 0;
    if (n > max) input.value = String(max);
    commitRow(id, Math.min(n, max), false);
  });
  rowsList.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.matches('[data-qty]')) return;
    const id = input.closest<HTMLElement>('[data-bulk-row]')?.dataset.id?.toLowerCase();
    if (!id) return;
    const q = countOf(state, id);
    input.value = q > 0 ? String(q) : '';
    const item = catalogue.get(id);
    if (item) announce(q > 0 ? `${item.name}: ${countLabel(item, q)} in your list.` : `${item.name} is not in your list.`);
  });
  rowsList.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-step]');
    if (!button) return;
    const row = button.closest<HTMLElement>('[data-bulk-row]');
    const id = row?.dataset.id?.toLowerCase();
    if (!row || !id) return;
    const step = Number(button.dataset.step) || 0;
    const unit = catalogue.get(id)?.bulkUnit ?? 'carton';
    const next = Math.max(0, Math.min(maxCountFor(unit), countOf(state, id) + step));
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
        (!mine || countOf(state, id) > 0) &&
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
  const estimateAbove = document.getElementById('bulk-estimate-above');
  const clearButton = document.getElementById('bulk-clear') as HTMLButtonElement | null;
  const quoteSubmit = document.getElementById('bulk-quote-submit') as HTMLButtonElement | null;
  const barText = document.getElementById('bulk-bar-text');
  const budgetInput = document.getElementById('bulk-budget') as HTMLInputElement | null;
  const budgetText = document.getElementById('bulk-budget-status');

  const isListed = (id: string) => catalogue.has(id) && !refusedIds.has(id);

  function sizeWords(est: ReturnType<typeof estimate>): string {
    const parts = [plural(est.lineCount, 'product', 'products')];
    if (est.totalCartons > 0) parts.push(plural(est.totalCartons, 'carton', 'cartons'));
    if (est.totalPieces > 0) parts.push(plural(est.totalPieces, 'piece', 'pieces'));
    return parts.join(', ');
  }

  function renderBudget(est: ReturnType<typeof estimate>): void {
    if (!budgetText) return;
    const status = budgetStatus(state.budgetUgx, est, unlocked);
    budgetText.className = 'mt-2 text-sm text-slate-700';
    if (status.kind === 'none') {
      budgetText.textContent = est.lineCount === 0 ? 'No list yet? Type a budget, say what you sell in the notes, and our team builds the list for you.' : '';
    } else if (status.kind === 'unmeasured') {
      budgetText.textContent = est.lineCount === 0
        ? `Budget ${formatUgx(status.budgetUgx)}. Send it with what you sell in the notes, and our team builds the list.`
        : `Budget ${formatUgx(status.budgetUgx)}. Enter your phone at the top to measure your list against it.`;
    } else if (status.kind === 'within') {
      budgetText.textContent = `${formatUgx(status.usedUgx)} of ${formatUgx(status.budgetUgx)} used. ${formatUgx(status.remainingUgx)} left.`;
    } else {
      budgetText.className = 'mt-2 text-sm font-bold text-red-700';
      budgetText.textContent = `${formatUgx(-status.remainingUgx)} over your budget of ${formatUgx(status.budgetUgx)}. Lower some cartons, or send it and our team will suggest a mix.`;
    }
  }

  function renderReview(): void {
    const listedCatalogue = new Map([...catalogue].filter(([id]) => !refusedIds.has(id)));
    const est = estimate(state, listedCatalogue);

    if (summary) {
      summary.textContent = est.lineCount === 0 ? 'No products yet. Choose cartons next to any product.' : `${sizeWords(est)}.`;
    }
    if (barText) {
      barText.textContent = '';
      if (est.lineCount === 0) barText.append(el('span', 'font-bold', state.budgetUgx ? `Budget ${formatUgx(state.budgetUgx)}` : 'Your list is empty'));
      else {
        barText.append(el('span', 'font-bold', sizeWords(est)));
        if (unlocked && est.estimatedTotalUgx > 0) barText.append(el('span', 'block text-xs text-slate-600', `${formatUgx(est.estimatedTotalUgx)} at bulk price`));
      }
    }
    if (estimateBox) estimateBox.hidden = est.lineCount === 0;
    if (estimateTotal) estimateTotal.textContent = formatUgx(est.estimatedTotalUgx);
    if (estimateUnpriced) {
      const unpriced = unlocked ? est.unpricedLineCount : 0;
      estimateUnpriced.hidden = unpriced === 0;
      estimateUnpriced.textContent = unpriced > 0
        ? `${plural(unpriced, 'product is', 'products are')} not in the total: no bulk price or carton size yet. Our team will price ${unpriced === 1 ? 'it' : 'them'}.`
        : '';
    }
    if (estimateAbove) {
      estimateAbove.hidden = est.aboveSelfServeCount === 0;
      estimateAbove.textContent = est.aboveSelfServeCount > 0
        ? `${plural(est.aboveSelfServeCount, 'product is', 'products are')} over ${SELF_SERVE_MAX_CARTONS} cartons. We take it, and our team confirms supply and the delivery date.`
        : '';
    }
    if (clearButton) clearButton.hidden = est.lineCount === 0;
    if (quoteSubmit) {
      quoteSubmit.textContent = est.lineCount === 0
        ? (state.budgetUgx ? 'Send my budget' : 'Send request')
        : `Send request (${plural(est.lineCount, 'product', 'products')})`;
    }
    renderBudget(est);

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
      if (!listed || !item) {
        meta.append(el('span', 'font-bold text-red-700', 'No longer on sale. Remove it to send your list.'));
      } else {
        meta.append(document.createTextNode(countLabel(item, line.count)));
        if (item.bulkUnit === 'carton' && line.count > SELF_SERVE_MAX_CARTONS) meta.append(document.createTextNode(` · over ${SELF_SERVE_MAX_CARTONS}: team confirms supply`));
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

      if (listed && item) {
        const qtyWrap = el('div', 'mt-2 flex items-center gap-2');
        const inputId = `bulk-line-${line.productId}`;
        const label = el('label', 'text-xs font-bold text-slate-700', item.bulkUnit === 'piece' ? 'Pieces' : 'Cartons');
        label.htmlFor = inputId;
        const input = el('input', 'h-11 w-24 rounded-xl border border-slate-300 px-2 text-center text-base font-bold outline-none focus-visible:border-slate-900 focus-visible:ring-2 focus-visible:ring-brand-primaryInk');
        input.id = inputId;
        input.type = 'text';
        input.inputMode = 'numeric';
        input.maxLength = 5;
        input.value = String(line.count);
        input.autocomplete = 'off';
        input.addEventListener('change', () => {
          const n = clampCount(input.value.replace(/\D/g, ''), item.bulkUnit) ?? 0;
          commitRow(line.productId, n, true);
          syncRowInputs();
        });
        qtyWrap.append(label, input);
        const pieces = item.bulkUnit === 'piece' ? line.count : item.unitsPerCarton ? line.count * item.unitsPerCarton : null;
        if (unlocked && item.bulkPriceUgx && pieces !== null) qtyWrap.append(el('span', 'ml-auto text-sm text-slate-800', formatUgx(item.bulkPriceUgx * pieces)));
        li.append(qtyWrap);
      }
      linesList.append(li);
    }
  }

  budgetInput?.addEventListener('change', () => {
    state = setBudget(state, budgetInput.value);
    budgetInput.value = state.budgetUgx ? state.budgetUgx.toLocaleString('en-US') : '';
    save();
    renderReview();
  });
  if (budgetInput && state.budgetUgx) budgetInput.value = state.budgetUgx.toLocaleString('en-US');

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
    const units = new Map([...catalogue].map(([id, item]) => [id, item.bulkUnit] as const));
    const { matches, misses } = parsePaste(pasteBox.value, codeIndex, units);
    for (const m of matches) {
      const item = catalogue.get(m.productId);
      if (!item) continue;
      state = setLine(state, item, countOf(state, m.productId) + m.count);
    }
    save();
    syncRowInputs();
    renderReview();
    applyFilters();

    pasteResult.textContent = '';
    if (matches.length === 0 && misses.length === 0) {
      pasteResult.append(el('p', 'text-slate-700', 'Paste at least one line, for example GP-C08, 5.'));
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

  // ---------------------------------------------------------------- access
  const accessError = document.getElementById('bulk-access-error');
  const accessSent = document.getElementById('bulk-access-sent');
  const accessPhone = document.getElementById('bulk-access-phone') as HTMLInputElement | null;
  const accessCode = document.getElementById('bulk-access-code') as HTMLInputElement | null;
  const stepPhone = document.getElementById('bulk-access-step-phone');
  const stepCode = document.getElementById('bulk-access-step-code');
  const sendButton = document.getElementById('bulk-access-send') as HTMLButtonElement | null;
  const verifyButton = document.getElementById('bulk-access-verify') as HTMLButtonElement | null;

  async function postJson(path: string, body: unknown): Promise<{ status: number; json: { success?: boolean; data?: { maskedPhone?: string }; error?: { message?: string } } | null }> {
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    } catch {
      return { status: 0, json: null };
    }
  }

  sendButton?.addEventListener('click', async () => {
    if (!accessPhone || !accessError || !accessSent) return;
    accessError.textContent = '';
    if (!isValidUgandanPhone(accessPhone.value.trim())) {
      accessError.textContent = 'Enter a Ugandan phone number, for example 0772 123 456.';
      accessPhone.focus();
      return;
    }
    sendButton.disabled = true;
    const { status, json } = await postJson('/api/bulk/access/start', { phone: accessPhone.value.trim() });
    sendButton.disabled = false;
    if (json?.success) {
      accessSent.textContent = `We texted a code to ${json.data?.maskedPhone ?? 'your phone'}. It works for 10 minutes.`;
      if (stepPhone) stepPhone.hidden = true;
      if (stepCode) stepCode.hidden = false;
      accessCode?.focus();
      return;
    }
    accessError.textContent = status === 0
      ? 'We could not reach our shop just now. Check your connection and try again.'
      : (json?.error?.message ?? 'We could not send a code just now. Try again in a minute.');
  });

  verifyButton?.addEventListener('click', async () => {
    if (!accessPhone || !accessCode || !accessError) return;
    accessError.textContent = '';
    const code = accessCode.value.replace(/\D/g, '');
    if (code.length !== 6) {
      accessError.textContent = 'Type the six-digit code from the SMS.';
      accessCode.focus();
      return;
    }
    verifyButton.disabled = true;
    const { status, json } = await postJson('/api/bulk/access/verify', { phone: accessPhone.value.trim(), code });
    if (json?.success) {
      // The token is now in an httpOnly cookie; the page renders the prices.
      window.location.reload();
      return;
    }
    verifyButton.disabled = false;
    accessError.textContent = status === 0
      ? 'We could not reach our shop just now. Check your connection and try again.'
      : (json?.error?.message ?? 'That code did not work. Try again.');
  });

  document.getElementById('bulk-access-again')?.addEventListener('click', () => {
    if (stepPhone) stepPhone.hidden = false;
    if (stepCode) stepCode.hidden = true;
    if (accessSent) accessSent.textContent = '';
    if (accessError) accessError.textContent = '';
    accessPhone?.focus();
  });

  document.getElementById('bulk-access-clear')?.addEventListener('click', async () => {
    await postJson('/api/bulk/access/clear', {});
    window.location.reload();
  });

  // ---------------------------------------------------------------- quote
  const form = document.getElementById('bulk-quote-form') as HTMLFormElement | null;
  const formError = document.getElementById('bulk-form-error');

  const fieldIds: Record<string, string> = {
    customerName: 'bq-name',
    phone: 'bq-phone',
    notes: 'bq-notes',
    budgetUgx: 'bulk-budget',
  };
  const notesWrap = document.getElementById('bq-notes-wrap') as HTMLDetailsElement | null;
  /** Unlocked buyers have no phone field: the number they confirmed with the code is used. */
  const phoneAsked = () => document.getElementById('bq-phone') !== null;

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
    if (field === 'notes' && notesWrap) notesWrap.open = true;
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
    if (phoneAsked() && !isValidUgandanPhone(value('phone'))) errors.push(['phone', 'Enter a Ugandan phone number, for example 0772 123 456.']);

    if (state.lines.length === 0 && !state.budgetUgx) {
      if (formError) formError.textContent = 'Your list is empty. Choose cartons next to at least one product, or type your budget.';
      return;
    }
    if (state.lines.length === 0 && value('notes').length < 5) errors.push(['notes', 'Tell us what you sell or need, so we can build the list for your budget.']);
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

    const lines = state.lines.map((l) => ({ productId: l.productId, count: l.count }));
    const keyed = idempotencyKeyFor(state, submissionFingerprint(value('phone') || 'confirmed', lines, state.budgetUgx), mintKey);
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
          phone: value('phone'),
          buyerType: value('buyerType'),
          notes: value('notes'),
          budgetUgx: state.budgetUgx ? String(state.budgetUgx) : '',
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
