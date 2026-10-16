/**
 * The Uganda location picker's client logic (location module, PARTs F/G/H).
 *
 * EXTRACTED FROM THE COMPONENT'S <script> on 2026-08-06 during the wiring
 * audit. The audit initially concluded this script was missing from the
 * /checkout bundle — a flat grep of the entry file found no search wiring —
 * and the truth turned out to be subtler: Astro links component scripts as
 * CHUNK IMPORTS (`import "./hoisted.X.js"`), and the audit's grep never
 * followed the graph. The behaviour was live all along.
 *
 * The extraction stays, because implicit hoisting is exactly what made the
 * wiring UNAUDITABLE: nothing greppable tied the page to the behaviour. As a
 * named module imported explicitly by the component AND by checkout's page
 * script, `grep locationPickerClient` now answers the wiring question in one
 * line. Init is idempotent because two importers must not double-wire a
 * search box.
 */
  // Deep import of pure-data modules, NOT '@goldplus/shared' (its index pulls
  // node:crypto and kills the client build — ledger #30).
  import { UGANDA_DISTRICTS, UGANDA_PLACE_ALIASES } from '../../../../packages/shared/src/locations/uganda';
  import { publicApiBase } from './api';

  interface PlaceOption {
    label: string;
    district: string;
    area?: string;
    areaSlug?: string;
    provenance?: string;
    /** What the customer typed, when it matched an alias of this area ("Kisaasi" → Kyanja). Shown, so the answer is not a surprise. */
    matchedAs?: string;
    isMetro?: boolean;
    /** Shown on the right instead of the district, e.g. "1.2 km from you". */
    note?: string;
    /** Chosen from the nearest-areas list after "Locate me". */
    fromPin?: boolean;
  }

  interface PinState {
    gpsLat: number;
    gpsLng: number;
    gpsAccuracyM?: number;
    gpsSource: 'device' | 'pasted_link';
  }

  // Local fallback index — always available offline. Starts from the bundled
  // verified vocabulary; the service-worker-cached metro index (brief F.5,
  // /locations-index-v1.json — gazetteer-sourced once imported) merges in on
  // load so metro search keeps working with zero network after first visit.
  const LOCAL_OPTIONS: PlaceOption[] = [
    ...UGANDA_PLACE_ALIASES.map((a) => ({ label: a.area, district: a.district, area: a.area })),
    ...UGANDA_DISTRICTS.map((d) => ({ label: d, district: d })),
  ];
  void (async () => {
    try {
      const res = await fetch('/locations-index-v1.json');
      const idx = await res.json();
      if (Array.isArray(idx?.entries)) {
        const seen = new Set(LOCAL_OPTIONS.map((o) => `${o.label}|${o.district}`.toLowerCase()));
        for (const e of idx.entries as Array<{ l: string; d: string; a?: string; s?: string }>) {
          const key = `${e.l}|${e.d}`.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          LOCAL_OPTIONS.push({ label: e.l, district: e.d, area: e.a, areaSlug: e.s });
        }
      }
    } catch {
      /* bundled vocabulary already covers the essentials */
    }
  })();

  function rankLocal(query: string, limit = 8): PlaceOption[] {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const starts: PlaceOption[] = [];
    const contains: PlaceOption[] = [];
    for (const opt of LOCAL_OPTIONS) {
      const l = opt.label.toLowerCase();
      if (l.startsWith(q)) starts.push(opt);
      else if (l.includes(q)) contains.push(opt);
    }
    return [...starts, ...contains].slice(0, limit);
  }

  function titleCase(q: string): string {
    return q.trim().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40);
  }

  /** Client-side pin parsing for the common shapes; short links go server-side. */
  function parsePinLocally(raw: string): PinState | null {
    const text = raw.trim();
    const m = text.match(/(-?\d{1,2}(?:\.\d{1,10})?)\s*,\s*(-?\d{1,3}(?:\.\d{1,10})?)/);
    const fromAt = text.match(/@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
    const pair = fromAt ?? m;
    if (!pair) return null;
    const lat = Number(pair[1]);
    const lng = Number(pair[2]);
    if (lat < -2.5 || lat > 5.5 || lng < 28 || lng > 36.5) return null;
    return { gpsLat: lat, gpsLng: lng, gpsSource: 'pasted_link' };
  }

  function setupWidget(el: HTMLElement) {
    const input = el.querySelector('.js-search-mode input[type="text"]') as HTMLInputElement | null;
    const dropdown = el.querySelector('.js-results-dropdown') as HTMLUListElement | null;
    const payloadInput = el.querySelector('.js-final-payload') as HTMLInputElement | null;
    const selectedCard = el.querySelector('.js-selected-card') as HTMLElement | null;
    const searchContainer = el.querySelector('.js-search-mode') as HTMLElement | null;
    const changeBtn = el.querySelector('.js-change-btn') as HTMLButtonElement | null;
    const cardPrimary = el.querySelector('.js-card-primary') as HTMLElement | null;
    const cardSecondary = el.querySelector('.js-card-secondary') as HTMLElement | null;
    const cardPin = el.querySelector('.js-card-pin') as HTMLElement | null;
    const districtSelect = el.querySelector('.js-district-select') as HTMLSelectElement | null;
    const errBox = el.querySelector('.js-err-box') as HTMLElement | null;
    const announce = el.querySelector('.js-result-announce') as HTMLElement | null;
    const manualText = el.querySelector('.js-manual-text') as HTMLTextAreaElement | null;
    const manualCommit = el.querySelector('.js-manual-commit') as HTMLButtonElement | null;
    const pinGps = el.querySelector('.js-pin-gps') as HTMLButtonElement | null;
    const pinLink = el.querySelector('.js-pin-link') as HTMLInputElement | null;
    const pinStatus = el.querySelector('.js-pin-status') as HTMLElement | null;
    const commitAnnounce = el.querySelector('.js-commit-announce') as HTMLElement | null;
    const cardAddPin = el.querySelector('.js-card-add-pin') as HTMLButtonElement | null;
    const cardPinStatus = el.querySelector('.js-card-pin-status') as HTMLElement | null;
    const fallbacks = el.querySelector('.js-fallbacks') as HTMLDetailsElement | null;
    if (!input || !dropdown || !payloadInput || !selectedCard || !searchContainer) return;

    let current: PlaceOption[] = [];
    let activeIndex = -1;
    let searchSeq = 0;
    let debounceTimer: number | undefined;
    let pin: PinState | null = null;

    function payloadWithPin(base: Record<string, unknown>): string {
      return JSON.stringify({ ...base, ...(pin ?? {}) });
    }

    function commit(opt: PlaceOption) {
      const hasArea = Boolean(opt.area && opt.area !== opt.district);
      payloadInput!.value = payloadWithPin({
        district: opt.district,
        ...(hasArea ? { area: opt.area } : {}),
        ...(opt.areaSlug ? { areaSlug: opt.areaSlug } : {}),
        displayLabel: hasArea ? `${opt.area}, ${opt.district}` : opt.district,
      });
      if (cardPrimary) cardPrimary.textContent = opt.area ?? opt.district;
      if (cardSecondary) cardSecondary.textContent = `District: ${opt.district} · ${opt.fromPin ? 'near your location' : 'Uganda'}`;
      finishCommit();
    }

    function commitManual() {
      const text = manualText?.value.trim() ?? '';
      if (text.length < 5) {
        if (pinStatus) pinStatus.textContent = '';
        manualText?.focus();
        return;
      }
      const district = districtSelect?.value || undefined;
      payloadInput!.value = payloadWithPin({
        manual: true,
        rawAddressText: text,
        ...(district ? { district } : {}),
      });
      if (cardPrimary) cardPrimary.textContent = text.slice(0, 60);
      if (cardSecondary) cardSecondary.textContent = district ? `District: ${district} · written directions` : 'Written directions. Our team confirms by phone';
      finishCommit();
      // The learning loop: what the customer typed and could not find.
      const missed = input!.value.trim();
      if (missed.length >= 2 && publicApiBase) {
        void fetch(`${publicApiBase}/locations/search-events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rawQuery: missed, resolvedVia: 'manual_entry' }),
        }).catch(() => undefined);
      }
    }

    function finishCommit() {
      // Hiding the search box takes the focused combobox with it, and focus
      // used to fall to the page body. If the customer was working in this
      // picker, it moves to "Change" and the choice is announced.
      const hadFocus = el.contains(document.activeElement);
      dropdown!.classList.add('hidden');
      input!.setAttribute('aria-expanded', 'false');
      input!.removeAttribute('aria-activedescendant');
      searchContainer!.classList.add('hidden');
      selectedCard!.classList.remove('hidden');
      errBox?.classList.add('hidden');
      // The error is answered: the field is no longer invalid.
      input!.removeAttribute('aria-invalid');
      input!.classList.remove('border-red-600', 'ring-2', 'ring-red-100');
      cardPin?.classList.toggle('hidden', !pin);
      cardAddPin?.classList.toggle('hidden', !!pin);
      if (commitAnnounce) {
        const chosen = [cardPrimary?.textContent, cardSecondary?.textContent].filter(Boolean).join(', ');
        commitAnnounce.textContent = chosen ? `Delivery location set: ${chosen}` : '';
      }
      if (hadFocus) changeBtn?.focus();
      payloadInput!.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function renderResults(list: PlaceOption[]) {
      dropdown!.innerHTML = '';
      activeIndex = -1;
      if (announce) announce.textContent = `${list.length} matching place${list.length === 1 ? '' : 's'}`;
      if (list.length === 0) {
        // A listbox may only own options: a bare <li> here is an invalid
        // listbox (axe: aria-required-children). It is an option that cannot
        // be chosen, so highlight() and Enter skip it.
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-disabled', 'true');
        li.setAttribute('aria-selected', 'false');
        li.className = 'px-4 py-3 text-sm text-gray-600';
        li.textContent = 'No match. Pick your district below, or write directions instead.';
        dropdown!.appendChild(li);
      } else {
        list.forEach((opt, i) => {
          const li = document.createElement('li');
          li.setAttribute('role', 'option');
          li.setAttribute('aria-selected', 'false');
          li.setAttribute('id', `${el.dataset.id}_opt_${i}`);
          li.className = 'px-4 py-3 cursor-pointer hover:bg-amber-50 flex items-baseline justify-between gap-3 min-h-[44px]';
          const nameSpan = document.createElement('span');
          nameSpan.className = 'font-bold text-brand-charcoal text-sm';
          nameSpan.textContent = opt.label;
          const distSpan = document.createElement('span');
          distSpan.className = 'text-xs text-gray-500 whitespace-nowrap';
          distSpan.textContent = opt.note ?? (opt.area ? `${opt.district} District` : 'District');
          if (opt.matchedAs) {
            const why = document.createElement('span');
            why.className = 'block text-xs font-normal text-gray-600';
            why.textContent = `includes ${opt.matchedAs}`;
            nameSpan.appendChild(why);
          }
          li.appendChild(nameSpan);
          li.appendChild(distSpan);
          li.addEventListener('mousedown', (e) => {
            e.preventDefault();
            commit(opt);
          });
          dropdown!.appendChild(li);
        });
      }
      dropdown!.classList.remove('hidden');
      input!.setAttribute('aria-expanded', 'true');
    }

    /** Server search first (the full gazetteer), local index as offline fallback. */
    async function runSearch(query: string) {
      const seq = ++searchSeq;
      const local = rankLocal(query);
      if (!publicApiBase) {
        current = local;
        renderResults(current);
        return;
      }
      try {
        const res = await fetch(`${publicApiBase}/locations/search?q=${encodeURIComponent(query)}`, {
          signal: AbortSignal.timeout(2500),
        });
        const json = await res.json().catch(() => null);
        if (seq !== searchSeq) return; // stale response
        const hits: PlaceOption[] = Array.isArray(json?.data?.hits)
          ? json.data.hits
              .filter((h: { kind: string }) => h.kind === 'area')
              .map((h: { displayLabel: string; areaName: string; currentDistrict: string; areaSlug: string; matchType: string; isMetro?: boolean; score?: number }) => ({
                label: h.displayLabel,
                district: h.currentDistrict,
                area: h.areaName !== h.currentDistrict ? h.areaName : undefined,
                areaSlug: h.areaSlug,
                provenance: h.matchType,
                isMetro: h.isMetro === true,
                matchedAs: h.matchType === 'alias_exact' ? titleCase(query) : undefined, // only a whole word: never "includes Kisa" mid-typing
              }))
              // The server's order is final: your saved and past areas, then Greater Kampala (Kampala, Wakiso,
              // Mukono), then the better match. Re-sorting here used to undo "your saved areas first".
          : [];
        // Server hits lead; local fills gaps (dedupe by label+district).
        const seen = new Set(hits.map((h) => `${h.label}|${h.district}`.toLowerCase()));
        current = [...hits, ...local.filter((l) => !seen.has(`${l.label}|${l.district}`.toLowerCase()))].slice(0, 8);
      } catch {
        if (seq !== searchSeq) return;
        current = local; // offline: the metro set that matters most still works
      }
      renderResults(current);
    }

    input.addEventListener('input', () => {
      payloadInput.value = '';
      const q = input.value.trim();
      if (debounceTimer) window.clearTimeout(debounceTimer);
      if (q.length < 2) {
        dropdown.classList.add('hidden');
        input.setAttribute('aria-expanded', 'false');
        return;
      }
      // 150ms debounce (brief F.4) — never one request per keystroke.
      debounceTimer = window.setTimeout(() => void runSearch(q), 150);
    });

    function highlight(delta: number) {
      const items = Array.from(dropdown!.querySelectorAll('[role="option"]:not([aria-disabled="true"])')) as HTMLElement[];
      if (items.length === 0) return;
      activeIndex = (activeIndex + delta + items.length) % items.length;
      items.forEach((item, i) => {
        item.classList.toggle('bg-amber-50', i === activeIndex);
        item.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
        if (i === activeIndex) {
          input!.setAttribute('aria-activedescendant', item.id);
          item.scrollIntoView({ block: 'nearest' });
        }
      });
    }

    input.addEventListener('keydown', (e) => {
      if (dropdown.classList.contains('hidden')) {
        // Typed, nothing chosen, suggestions not open yet (the debounce had
        // not fired): Enter searches now rather than submitting no location.
        if (e.key === 'Enter' && !payloadInput.value && input.value.trim().length >= 2) {
          e.preventDefault();
          if (debounceTimer) window.clearTimeout(debounceTimer);
          void runSearch(input.value.trim());
        }
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(-1); }
      else if (e.key === 'Enter') {
        // Never let Enter (or the phone keyboard's Search key) fall through
        // while suggestions are open: it implicitly submitted the enclosing
        // novalidate checkout form with no location, and the typed search and
        // promo code were lost on the re-render. It chooses, or it does nothing.
        e.preventDefault();
        if (activeIndex >= 0 && current[activeIndex]) commit(current[activeIndex]);
        else if (current.length === 1) commit(current[0]);
      } else if (e.key === 'Escape') {
        dropdown.classList.add('hidden');
        input.setAttribute('aria-expanded', 'false');
      }
    });

    input.addEventListener('blur', () => {
      window.setTimeout(() => {
        dropdown.classList.add('hidden');
        input.setAttribute('aria-expanded', 'false');
      }, 150);
    });

    districtSelect?.addEventListener('change', () => {
      const district = districtSelect.value;
      // With directions typed, the district is their context (committed with them); otherwise choosing it is the answer.
      if (district && (manualText?.value.trim().length ?? 0) > 0) return;
      if (district) commit({ label: district, district });
    });

    manualCommit?.addEventListener('click', commitManual);

    // ── Pin capture (PART G.1) ─────────────────────────────────────────────
    /**
     * The phone's location, the easiest answer there is. Before a place is chosen it IS the answer: the area is
     * named from the pin (GET /locations/near, the quote's own rule) and committed, so the fee shows at once.
     * After a place is chosen it is added for the rider. The customer always sees the area and can change it.
     */
    function captureDevicePin(statusEl: HTMLElement | null) {
      const say = (t: string) => { if (statusEl) statusEl.textContent = t; };
      if (!navigator.geolocation) { say('Location is not available on this device. Search your area instead.'); return; }
      say('Finding you…');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          pin = {
            gpsLat: Number(pos.coords.latitude.toFixed(6)),
            gpsLng: Number(pos.coords.longitude.toFixed(6)),
            gpsAccuracyM: Math.round(pos.coords.accuracy),
            gpsSource: 'device',
          };
          const rough = pos.coords.accuracy > 100 ? ` Accuracy is about ${Math.round(pos.coords.accuracy)} m.` : '';
          void afterPin(statusEl, `Got your location ✓.${rough}`);
        },
        (err) => {
          say(
            err && err.code === 1
              ? 'Location is blocked for this site. Search your area instead, or allow location in your browser settings.'
              : 'Could not get your location. Search your area instead.',
          );
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
      );
    }

    /**
     * A pin arrived (device or link). Something already chosen: attach it for the rider. Nothing chosen: offer the
     * nearest areas as one-tap choices, closest first. Never decide alone: measured on our own area points, one
     * automatic answer was wrong for about one pin in five; the right area was in the nearest three nine in ten.
     */
    async function afterPin(statusEl: HTMLElement | null, okText: string) {
      const say = (t: string) => { if (statusEl) statusEl.textContent = t; };
      if (payloadInput!.value || !pin) { say(okText); refreshPayloadPin(); return; }
      say('Finding areas near you…');
      let areas: Array<{ areaSlug: string; label: string; district: string; km: number }> = [];
      if (publicApiBase) {
        try {
          const res = await fetch(`${publicApiBase}/locations/near?lat=${pin.gpsLat}&lng=${pin.gpsLng}`, { signal: AbortSignal.timeout(5000) });
          const json = await res.json().catch(() => null);
          if (Array.isArray(json?.data?.areas)) areas = json.data.areas;
        } catch { /* the honest message below */ }
      }
      if (areas.length === 0) {
        say('We have your exact location for the rider. Type your area so we can price delivery.');
        input!.focus();
        return;
      }
      // No focus here: on a phone it raises the keyboard over the very choices we are offering.
      const roughKm = pin.gpsAccuracyM && pin.gpsAccuracyM > 1500 ? Math.round(pin.gpsAccuracyM / 100) / 10 : null;
      say(
        roughKm
          ? `This device only knows your location to about ${roughKm} km, so check these carefully. Not listed? Type your area.`
          : 'Tap your area below. Not listed? Type it instead.',
      );
      current = areas.map((a) => {
        const name = a.label.split(',')[0].trim();
        return {
          label: a.label,
          district: a.district,
          area: name !== a.district ? name : undefined,
          areaSlug: a.areaSlug,
          note: a.km < 1 ? 'under 1 km from you' : `${a.km} km from you`,
          fromPin: true,
        };
      });
      renderResults(current);
      highlight(1);
    }

    pinGps?.addEventListener('click', () => captureDevicePin(pinStatus));
    cardAddPin?.addEventListener('click', () => captureDevicePin(cardPinStatus));

    async function handlePinLink() {
      const raw = pinLink?.value.trim() ?? '';
      if (!raw) return;
      let parsed = parsePinLocally(raw);
      if (!parsed && publicApiBase && /goo\.gl|g\.co/.test(raw)) {
        if (pinStatus) pinStatus.textContent = 'Reading the link…';
        try {
          const res = await fetch(`${publicApiBase}/locations/resolve-link`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: raw }),
            signal: AbortSignal.timeout(6000),
          });
          const json = await res.json().catch(() => null);
          if (json?.data?.pin) {
            parsed = { gpsLat: json.data.pin.lat, gpsLng: json.data.pin.lng, gpsSource: 'pasted_link' };
          }
        } catch {
          /* fall through to the honest failure message */
        }
      }
      if (parsed) {
        pin = parsed;
        if (fallbacks) fallbacks.open = false;
        await afterPin(pinStatus, 'Location from the link ✓');
      } else if (pinStatus) {
        pinStatus.textContent = 'That link has no readable location, the order still works without a pin.';
      }
    }
    pinLink?.addEventListener('change', () => void handlePinLink());
    pinLink?.addEventListener('paste', () => window.setTimeout(() => void handlePinLink(), 50));

    /** A pin captured after selection joins the already-committed payload. */
    function refreshPayloadPin() {
      cardPin?.classList.toggle('hidden', !pin);
      cardAddPin?.classList.toggle('hidden', !!pin);
      if (pin && cardPinStatus) cardPinStatus.textContent = '';
      if (!payloadInput!.value) return;
      try {
        const existing = JSON.parse(payloadInput!.value);
        payloadInput!.value = JSON.stringify({ ...existing, ...(pin ?? {}) });
        payloadInput!.dispatchEvent(new Event('change', { bubbles: true }));
      } catch {
        /* uncommitted payload — pin joins at commit time */
      }
    }

    changeBtn?.addEventListener('click', () => {
      selectedCard.classList.add('hidden');
      searchContainer.classList.remove('hidden');
      payloadInput.value = '';
      // A new place gets its own pin: the old one could be home while the new answer is the office.
      pin = null;
      if (pinStatus) pinStatus.textContent = '';
      if (cardPinStatus) cardPinStatus.textContent = '';
      if (districtSelect) districtSelect.value = '';
      input.value = '';
      input.focus();
    });
  }

  export function initLocationPickers(): void {
  document.querySelectorAll<HTMLElement>('.js-uganda-location-picker').forEach((el) => {
    // Idempotent: the module may be imported by BOTH the page script and the
    // component script, and double-wiring a search box double-fires requests.
    if (el.dataset.pickerInitialised === 'true') return;
    el.dataset.pickerInitialised = 'true';
    setupWidget(el);
  });
}

// Auto-init on import, and again on late DOM (the module can load before or
// after the picker markup depending on which page carried it).
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initLocationPickers());
} else {
  initLocationPickers();
}
