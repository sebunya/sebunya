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
    const manualToggle = el.querySelector('.js-manual-toggle') as HTMLButtonElement | null;
    const manualMode = el.querySelector('.js-manual-mode') as HTMLElement | null;
    const manualText = el.querySelector('.js-manual-text') as HTMLTextAreaElement | null;
    const manualCommit = el.querySelector('.js-manual-commit') as HTMLButtonElement | null;
    const pinGps = el.querySelector('.js-pin-gps') as HTMLButtonElement | null;
    const pinLink = el.querySelector('.js-pin-link') as HTMLInputElement | null;
    const pinStatus = el.querySelector('.js-pin-status') as HTMLElement | null;
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
      if (cardSecondary) cardSecondary.textContent = `District: ${opt.district} · Uganda`;
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
      if (cardSecondary) cardSecondary.textContent = district ? `District: ${district} · written directions` : 'Written directions — our team confirms by phone';
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
      dropdown!.classList.add('hidden');
      input!.setAttribute('aria-expanded', 'false');
      searchContainer!.classList.add('hidden');
      selectedCard!.classList.remove('hidden');
      errBox?.classList.add('hidden');
      cardPin?.classList.toggle('hidden', !pin);
      payloadInput!.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function renderResults(list: PlaceOption[]) {
      dropdown!.innerHTML = '';
      activeIndex = -1;
      if (announce) announce.textContent = `${list.length} matching place${list.length === 1 ? '' : 's'}`;
      if (list.length === 0) {
        const li = document.createElement('li');
        li.className = 'px-4 py-3 text-sm text-gray-500';
        li.textContent = 'No match — pick your district below, or write directions instead.';
        dropdown!.appendChild(li);
      } else {
        list.forEach((opt, i) => {
          const li = document.createElement('li');
          li.setAttribute('role', 'option');
          li.setAttribute('id', `${el.dataset.id}_opt_${i}`);
          li.className = 'px-4 py-3 cursor-pointer hover:bg-amber-50 flex items-baseline justify-between gap-3 min-h-[44px]';
          const nameSpan = document.createElement('span');
          nameSpan.className = 'font-bold text-brand-charcoal text-sm';
          nameSpan.textContent = opt.label;
          const distSpan = document.createElement('span');
          distSpan.className = 'text-xs text-gray-500 whitespace-nowrap';
          distSpan.textContent = opt.area ? `${opt.district} District` : 'District';
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
              .map((h: { displayLabel: string; areaName: string; currentDistrict: string; areaSlug: string; matchType: string }) => ({
                label: h.displayLabel,
                district: h.currentDistrict,
                area: h.areaName !== h.currentDistrict ? h.areaName : undefined,
                areaSlug: h.areaSlug,
                provenance: h.matchType,
              }))
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
      const items = Array.from(dropdown!.querySelectorAll('[role="option"]')) as HTMLElement[];
      if (items.length === 0) return;
      activeIndex = (activeIndex + delta + items.length) % items.length;
      items.forEach((item, i) => {
        item.classList.toggle('bg-amber-50', i === activeIndex);
        if (i === activeIndex) {
          input!.setAttribute('aria-activedescendant', item.id);
          item.scrollIntoView({ block: 'nearest' });
        }
      });
    }

    input.addEventListener('keydown', (e) => {
      if (dropdown.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(-1); }
      else if (e.key === 'Enter') {
        if (activeIndex >= 0 && current[activeIndex]) { e.preventDefault(); commit(current[activeIndex]); }
        else if (current.length === 1) { e.preventDefault(); commit(current[0]); }
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
      if (district && !manualMode?.classList.contains('hidden')) return; // manual mode uses it as context
      if (district) commit({ label: district, district });
    });

    manualToggle?.addEventListener('click', () => {
      manualMode?.classList.toggle('hidden');
      manualText?.focus();
    });
    manualCommit?.addEventListener('click', commitManual);

    // ── Pin capture (PART G.1) ─────────────────────────────────────────────
    pinGps?.addEventListener('click', () => {
      if (!navigator.geolocation) {
        if (pinStatus) pinStatus.textContent = 'Location is not available on this device.';
        return;
      }
      if (pinStatus) pinStatus.textContent = 'Getting your location…';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          pin = {
            gpsLat: Number(pos.coords.latitude.toFixed(6)),
            gpsLng: Number(pos.coords.longitude.toFixed(6)),
            gpsAccuracyM: Math.round(pos.coords.accuracy),
            gpsSource: 'device',
          };
          if (pinStatus) {
            pinStatus.textContent =
              pos.coords.accuracy > 100
                ? `Pin captured, but accuracy is about ${Math.round(pos.coords.accuracy)} m — keep it if the area looks right.`
                : 'Pin captured ✓';
          }
          refreshPayloadPin();
        },
        () => {
          if (pinStatus) pinStatus.textContent = 'Could not get your location — you can paste a maps link instead.';
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      );
    });

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
        if (pinStatus) pinStatus.textContent = 'Pin captured from the link ✓';
        refreshPayloadPin();
      } else if (pinStatus) {
        pinStatus.textContent = 'That link has no readable location — the order still works without a pin.';
      }
    }
    pinLink?.addEventListener('change', () => void handlePinLink());
    pinLink?.addEventListener('paste', () => window.setTimeout(() => void handlePinLink(), 50));

    /** A pin captured after selection joins the already-committed payload. */
    function refreshPayloadPin() {
      cardPin?.classList.toggle('hidden', !pin);
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
