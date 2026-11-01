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
  import { PLUS_CODE, plusCodePoint } from './plusCodeInput';

  interface PlaceOption {
    label: string;
    district: string;
    area?: string;
    areaSlug?: string;
    provenance?: string;
    /** What the customer typed, when it matched an alias of this area ("Kisaasi" → Kyanja). Shown, so the answer is not a surprise. */
    matchedAs?: string;
    /** A landmark of ours that matched ("Parliament"): the row says it is for that place. */
    viaLandmark?: string;
    isMetro?: boolean;
    /** Shown on the right instead of the district, e.g. "1.2 km from you". */
    note?: string;
    /** Chosen from the nearest-areas list after "Locate me". */
    fromPin?: boolean;
    /** A building or place from the deep layer (Google Places): choosing it pins it, then offers our areas. */
    deepPlaceId?: string;
    /** A row that does something instead of choosing: ask the deep layer, locate, or open the area list. */
    action?: 'deep-search' | 'locate' | 'fallbacks';
    /** A row that cannot be chosen (the "Results from Google Maps" credit). */
    inert?: boolean;
  }

  /**
   * Is the customer typing something finer than an area: a building, plot, mall, estate, school, stage?
   * Only then (or when our search finds nothing) is the paid deep layer offered.
   */
  const SPECIFIC_CUES =
    /\b(mall|plaza|arcade|tower|towers|house|apartments?|apts|flats|hostel|hotel|lodge|church|mosque|cathedral|school|college|university|hospital|clinic|market|stage|petrol|station|shell|total|stabex|estate|road|rd|street|st|avenue|ave|lane|close|crescent|plot|building|bldg|complex|centre|center|supermarket|bank|office|offices|park|courts?|villas?|gardens?|heights|junction|roundabout)\b/i;
  export function looksSpecific(q: string): boolean {
    const t = q.trim();
    return /\d/.test(t) || SPECIFIC_CUES.test(t) || t.split(/\s+/).filter(Boolean).length >= 3;
  }

  let deepStatus: Promise<boolean> | null = null;
  function deepConfigured(): Promise<boolean> {
    if (!publicApiBase) return Promise.resolve(false);
    deepStatus ??= fetch(`${publicApiBase}/locations/deep-status`, { signal: AbortSignal.timeout(3000) })
      .then((r) => r.json())
      .then((j) => j?.data?.configured === true)
      .catch(() => false);
    return deepStatus;
  }

  function newSessionToken(): string {
    try {
      return crypto.randomUUID();
    } catch {
      return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    }
  }

  interface PinState {
    gpsLat: number;
    gpsLng: number;
    gpsAccuracyM?: number;
    gpsSource: 'device' | 'pasted_link' | 'map_place';
    /** Google place ID, kept with the order (the terms allow it) after the coordinates are purged. */
    placeId?: string;
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
    const fromPlusCode = plusCodePoint(text);
    if (fromPlusCode) return { gpsLat: fromPlusCode.lat, gpsLng: fromPlusCode.lng, gpsSource: 'pasted_link' };
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
    const withPinCapture = el.dataset.withPin === '1';
    // 0193: the areas "Locate me" last offered, so the choice can teach us whether our area points are right.
    let lastOffer: string[] | null = null;
    const surface = ['pdp', 'cart', 'checkout', 'account'].includes(el.dataset.surface ?? '') ? el.dataset.surface : 'checkout';

    /**
     * Did "Locate me" offer the right areas? Sent to our own server (which adds the visitor's token) with the
     * customer's own pin, so area points learn where customers really are. Best-effort: never delays the customer.
     */
    function recordLocateOutcome(opt: PlaceOption) {
      if (!lastOffer || !pin || pin.gpsSource === 'map_place' || !opt.areaSlug) return;
      const rank = lastOffer.indexOf(opt.areaSlug) + 1;
      const body = {
        kind: rank > 0 ? 'locate_offer_chosen' : 'locate_offer_missed',
        surface,
        areaSlug: opt.areaSlug,
        district: opt.district,
        ...(rank > 0 ? { offerRank: rank } : {}),
        pin: { lat: pin.gpsLat, lng: pin.gpsLng, accuracyM: pin.gpsAccuracyM ?? null, source: pin.gpsSource },
      };
      lastOffer = null;
      try {
        void fetch('/location-signal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => undefined);
      } catch { /* never in the customer's way */ }
    }
    // The deep layer: one billing session per search-and-pick, switched off for the page when the server says
    // "not configured" or the month's budget is spent.
    let deepSession = newSessionToken();
    // Off until the server says the deep layer exists (one free status call per page), so a site without a key
    // never shows the row. Shared across pickers on the page.
    let deepEnabled = false;
    if (el.dataset.deep !== 'off') void deepConfigured().then((ok) => { deepEnabled = ok; });
    let deepTimer: number | undefined;
    let deepSeq = 0;
    let lastDeepQuery = '';
    let pinnedPlaceName = '';
    // A search our map could not answer ("Parliament"), kept until the customer picks an area some other way: the
    // pair teaches the gazetteer (nightly landmark learning) and the words go to the rider line.
    let lastMiss = '';
    const searchSession = newSessionToken();

    function payloadWithPin(base: Record<string, unknown>): string {
      return JSON.stringify({ ...base, ...(pin ?? {}) });
    }

    function commit(opt: PlaceOption) {
      recordLocateOutcome(opt);
      resolveMiss(opt);
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

    /** The customer could not find "Parliament", then chose an area: tell the learning loop, and the rider. */
    function resolveMiss(opt: PlaceOption) {
      const missed = lastMiss;
      lastMiss = '';
      if (!missed || missed.length < 3) return;
      el.dispatchEvent(new CustomEvent('gp:place-typed', { bubbles: true, detail: { text: titleCase(missed) } }));
      if (!opt.areaSlug || !publicApiBase) return;
      void fetch(`${publicApiBase}/locations/search-events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawQuery: missed.slice(0, 120), resolvedAreaSlug: opt.areaSlug, resolvedVia: 'landmark', sessionId: searchSession }),
        keepalive: true,
      }).catch(() => undefined);
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
      if (cardPin && pin) {
        cardPin.textContent = pin.gpsSource === 'map_place' ? `📍 ${pinnedPlaceName || 'The building'} is pinned for the rider · ` : '📍 Your exact spot goes to the rider · ';
        // The customer sees the actual point, not only an area name.
        const map = document.createElement('a');
        map.href = `https://www.google.com/maps?q=${pin.gpsLat},${pin.gpsLng}`;
        map.target = '_blank';
        map.rel = 'noopener';
        map.className = 'underline font-bold';
        map.textContent = 'View on map';
        cardPin.append(map);
      }
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
      const choosable = list.filter((o) => !o.inert && !o.action).length;
      if (announce) announce.textContent = `${choosable} matching place${choosable === 1 ? '' : 's'}`;
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
      } else if (list.every((o) => o.inert || o.action) && list.some((o) => o.action === 'locate' || o.action === 'fallbacks')) {
        // Our map has no answer: rows that move the customer forward instead of a dead end (rendered below).
        list.forEach((opt, i) => {
          const li = document.createElement('li');
          li.setAttribute('role', 'option');
          li.setAttribute('aria-selected', 'false');
          li.setAttribute('id', `${el.dataset.id}_opt_${i}`);
          if (opt.inert) {
            li.setAttribute('aria-disabled', 'true');
            li.className = 'px-4 py-3 text-sm text-gray-700';
            li.textContent = opt.label;
          } else {
            li.className = 'px-4 py-3 cursor-pointer hover:bg-amber-50 min-h-[44px] text-sm font-bold text-brand-charcoal';
            li.textContent = opt.label;
            li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(opt); });
          }
          dropdown!.appendChild(li);
        });
        dropdown!.classList.remove('hidden');
        input!.setAttribute('aria-expanded', 'true');
        return;
      } else {
        list.forEach((opt, i) => {
          const li = document.createElement('li');
          li.setAttribute('role', 'option');
          li.setAttribute('aria-selected', 'false');
          li.setAttribute('id', `${el.dataset.id}_opt_${i}`);
          if (opt.inert) {
            li.setAttribute('aria-disabled', 'true');
            li.className = 'px-4 py-2 text-[11px] text-gray-500 text-right';
            li.textContent = opt.label;
            dropdown!.appendChild(li);
            return;
          }
          li.className = opt.action
            ? 'px-4 py-3 cursor-pointer hover:bg-amber-50 flex items-center gap-2 min-h-[44px] text-sm font-bold text-brand-charcoal bg-slate-50'
            : 'px-4 py-3 cursor-pointer hover:bg-amber-50 flex items-baseline justify-between gap-3 min-h-[44px]';
          if (opt.action) {
            li.textContent = opt.label;
            li.addEventListener('mousedown', (e) => {
              e.preventDefault();
              choose(opt);
            });
            dropdown!.appendChild(li);
            return;
          }
          const nameSpan = document.createElement('span');
          nameSpan.className = 'font-bold text-brand-charcoal text-sm';
          nameSpan.textContent = opt.label;
          const distSpan = document.createElement('span');
          distSpan.className = 'text-xs text-gray-500 whitespace-nowrap';
          distSpan.textContent = opt.note ?? (opt.area ? `${opt.district} District` : 'District');
          if (opt.matchedAs || opt.viaLandmark) {
            const why = document.createElement('span');
            why.className = 'block text-xs font-normal text-gray-600';
            why.textContent = opt.viaLandmark ? `for ${opt.viaLandmark}` : `includes ${opt.matchedAs}`;
            nameSpan.appendChild(why);
          }
          li.appendChild(nameSpan);
          li.appendChild(distSpan);
          li.addEventListener('mousedown', (e) => {
            e.preventDefault();
            choose(opt);
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
              .map((h: { displayLabel: string; areaName: string; currentDistrict: string; areaSlug: string; matchType: string; isMetro?: boolean; score?: number; viaAlias?: string; viaLandmark?: string }) => ({
                label: h.displayLabel,
                district: h.currentDistrict,
                area: h.areaName !== h.currentDistrict ? h.areaName : undefined,
                areaSlug: h.areaSlug,
                provenance: h.matchType,
                isMetro: h.isMetro === true,
                // The gazetteer's own spelling ("includes Najjera" even when "Najeera" was typed); a landmark says which.
                matchedAs: h.viaAlias ? h.viaAlias : h.matchType === 'alias_exact' ? titleCase(query) : undefined,
                viaLandmark: h.viaLandmark || undefined,
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
      current = withDeepOffer(current, query);
      if (current.length === 0 && query.length >= 3) {
        lastMiss = query;
        current = noMatchRows(query);
      } else if (current.every((o) => o.action) && query.length >= 3) {
        lastMiss = query;
      }
      renderResults(current);
      // Ask the deep layer by itself once the customer pauses, when it is the likely answer: our search found
      // nothing, or they are clearly typing a building (the offer row is showing) with six or more characters.
      // Each ask is one paid request; the server caps them per session and per day.
      const offered = current.some((o) => o.action === 'deep-search');
      const nothingOfOurs = current.every((o) => o.action);
      if (deepEnabled && offered && ((nothingOfOurs && query.length >= 5) || query.length >= 6)) {
        if (deepTimer) window.clearTimeout(deepTimer);
        deepTimer = window.setTimeout(() => { if (input!.value.trim() === query) void runDeep(query); }, 700);
      }
    }

    /**
     * Offer the deep layer only when it can add something: our search found nothing, or the customer is typing
     * something finer than an area (a building, plot, mall, stage) and our top answer is not an exact area match.
     */
    function withDeepOffer(list: PlaceOption[], query: string): PlaceOption[] {
      if (!deepEnabled || query.length < 4) return list;
      const exactTop = list[0] && (list[0].provenance === 'area_exact' || list[0].provenance === 'alias_exact' || list[0].provenance === 'group_exact');
      if (list.length > 0 && (!looksSpecific(query) || (exactTop && !SPECIFIC_CUES.test(query) && !/\d/.test(query)))) return list;
      return [...list.slice(0, 6), { label: `🔎 Find the building or place "${query.slice(0, 40)}"`, district: '', action: 'deep-search' }];
    }

    /** Our map has no answer for this text: say so plainly and offer the two ways forward. */
    function noMatchRows(query: string): PlaceOption[] {
      const rows: PlaceOption[] = [{ label: `"${query.slice(0, 40)}" is not on our map yet. Pick its area, and we will tell the rider to look for it.`, district: '', inert: true }];
      if (withPinCapture) rows.push({ label: '📍 Use my location', district: '', action: 'locate' });
      rows.push({ label: 'Choose the area from a list', district: '', action: 'fallbacks' });
      return rows;
    }

    /** One paid suggestion call (the server enforces budget, per-session cap and cache). */
    async function runDeep(query: string) {
      if (!deepEnabled || !publicApiBase) return;
      if (query === lastDeepQuery) return;
      lastDeepQuery = query;
      const seq = ++deepSeq;
      const ours = current.filter((o) => !o.action && !o.inert && !o.deepPlaceId);
      current = [...ours, { label: 'Searching buildings and places…', district: '', inert: true }];
      renderResults(current);
      let places: Array<{ placeId: string; name: string; detail: string }> = [];
      let status = 'unavailable';
      try {
        const res = await fetch(`${publicApiBase}/locations/deep-search`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ q: query, session: deepSession }),
          signal: AbortSignal.timeout(5000),
        });
        const json = await res.json().catch(() => null);
        status = String(json?.data?.status ?? 'unavailable');
        if (Array.isArray(json?.data?.places)) places = json.data.places;
      } catch { /* honest line below */ }
      if (seq !== deepSeq || input!.value.trim() !== query) return;
      if (status === 'unavailable' && !places.length) {
        // Google refused or failed: say so, and stop offering it this visit (a dead option offered twice is worse).
        deepEnabled = false;
        current = ours.length
          ? [...ours, { label: 'Building search is not working right now. Pick an area above.', district: '', inert: true }]
          : noMatchRows(query);
        renderResults(current);
        return;
      }
      if (status === 'not_configured' || status === 'budget_reached') {
        // No deep layer this visit: back to exactly what the picker said before it existed.
        deepEnabled = false;
        current = ours;
        renderResults(current);
        return;
      }
      const found: PlaceOption[] = places.map((p) => ({ label: p.name, district: '', note: p.detail, deepPlaceId: p.placeId }));
      // An exact area match of ours stays on top ("Kira road": Kira first, then the buildings); otherwise the
      // buildings lead, because that is what the customer was typing.
      const oursExact = ['area_exact', 'alias_exact', 'group_exact'].includes(String(ours[0]?.provenance));
      const credit: PlaceOption = { label: 'Results from Google Maps', district: '', inert: true };
      current = found.length
        ? oursExact
          ? [...ours.slice(0, 2), ...found, credit]
          : [...found, ...ours.slice(0, 3), credit]
        : ours.length
          ? [...ours, { label: 'No building found. Pick an area above.', district: '', inert: true }]
          : noMatchRows(query);
      renderResults(current);
    }

    /**
     * A building chosen: pin it for the rider and put its name where the rider reads. Then the customer names the
     * area with OUR search, and that prices the order. Google's point is never matched to one of our areas (Maps
     * Platform Terms §3.2.3(c)(iv) forbid Places coordinates as input to point-in-polygon analysis). Google's own
     * locality line is shown so the customer knows what to type; we do not search with it on their behalf.
     */
    async function pickDeep(opt: PlaceOption) {
      if (!opt.deepPlaceId || !publicApiBase) return;
      if (pinStatus) pinStatus.textContent = `Saving ${opt.label}…`;
      dropdown!.classList.add('hidden');
      let data: { status?: string; point?: { lat: number; lng: number } | null } | null = null;
      try {
        const res = await fetch(`${publicApiBase}/locations/deep-place`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ placeId: opt.deepPlaceId, session: deepSession }),
          signal: AbortSignal.timeout(5000),
        });
        data = (await res.json().catch(() => null))?.data ?? null;
      } catch { /* honest line below */ }
      deepSession = newSessionToken(); // the pick ended Google's billing session
      lastDeepQuery = '';
      if (!data?.point) {
        if (pinStatus) pinStatus.textContent = 'Could not place that building. Type your area instead.';
        return;
      }
      pin = { gpsLat: Number(data.point.lat.toFixed(6)), gpsLng: Number(data.point.lng.toFixed(6)), gpsSource: 'map_place', placeId: opt.deepPlaceId };
      pinnedPlaceName = opt.label;
      el.dispatchEvent(new CustomEvent('gp:place-picked', { bubbles: true, detail: { name: opt.label, detail: opt.note ?? '' } }));
      input!.value = '';
      if (pinStatus) {
        pinStatus.textContent = `📍 ${opt.label} is saved for the rider${opt.note ? ` (Google Maps lists it in ${opt.note})` : ''}. Now type the area it is in to see the delivery fee.`;
      }
      input!.focus();
    }

    function choose(opt: PlaceOption) {
      if (opt.inert) return;
      if (opt.action === 'deep-search') { void runDeep(input!.value.trim()); return; }
      if (opt.action === 'locate') { dropdown!.classList.add('hidden'); captureDevicePin(pinStatus); return; }
      if (opt.action === 'fallbacks') {
        dropdown!.classList.add('hidden');
        if (fallbacks) fallbacks.open = true;
        districtSelect?.focus();
        return;
      }
      if (opt.deepPlaceId) { void pickDeep(opt); return; }
      commit(opt);
    }

    input.addEventListener('input', () => {
      payloadInput.value = '';
      const q = input.value.trim();
      // A Plus Code typed or pasted into the search box is a location, not an area name: take it as a pin.
      const coded = withPinCapture ? plusCodePoint(q) : null;
      if (coded) {
        if (debounceTimer) window.clearTimeout(debounceTimer);
        pin = { gpsLat: coded.lat, gpsLng: coded.lng, gpsSource: 'pasted_link' };
        dropdown.classList.add('hidden');
        void afterPin(pinStatus, 'Location from the Plus Code ✓');
        return;
      }
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
        const choosable = current.filter((o) => !o.inert);
        if (activeIndex >= 0 && choosable[activeIndex]) choose(choosable[activeIndex]);
        else if (choosable.length === 1) choose(choosable[0]);
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
      const roughKm = pin.gpsAccuracyM && pin.gpsAccuracyM > 1500 ? Math.round(pin.gpsAccuracyM / 100) / 10 : null;
      // Owner, 2026-10-19: "Use my location should put the actual location, not just a zone." A phone fix is the
      // answer itself: commit it in one tap, priced from the nearest area, with the area shown and "Change" beside it.
      // Only a vague fix (a laptop on Wi-Fi, km off) still asks the customer to pick, because then it is not their spot.
      if (!roughKm && pin.gpsSource === 'device') {
        commitCurrentLocation(areas[0]);
        say('');
        return;
      }
      offerAreas(
        areas,
        statusEl,
        roughKm
          ? `This device only knows your location to about ${roughKm} km, so check these carefully. Not listed? Type your area.`
          : 'Tap your area below. Not listed? Type it instead.',
        'you',
      );
    }

    /**
     * "Use my location" in one tap: the customer's own phone point is the location; the nearest of our areas names
     * it and prices it (the quote's own rule). The card says it is their current location and which area it was
     * priced as, so a wrong area is one tap ("Change") away.
     */
    function commitCurrentLocation(a: { areaSlug: string; label: string; district: string; km: number }) {
      const name = a.label.split(',')[0].trim();
      const hasArea = name !== a.district;
      lastOffer = null;
      payloadInput!.value = payloadWithPin({
        district: a.district,
        ...(hasArea ? { area: name } : {}),
        areaSlug: a.areaSlug,
        displayLabel: `Current location near ${hasArea ? `${name}, ${a.district}` : a.district}`,
      });
      const accuracy = pin?.gpsAccuracyM ? ` · within ${pin.gpsAccuracyM} m` : '';
      if (cardPrimary) cardPrimary.textContent = 'Your current location';
      // "Change" sits beside the card for a wrong area; no need to say it twice.
      if (cardSecondary) cardSecondary.textContent = `Near ${hasArea ? `${name}, ${a.district}` : a.district}${accuracy}`;
      finishCommit();
    }

    /**
     * The nearest of OUR areas to the customer's OWN pin (their phone's location), as one-tap choices, never chosen
     * for them. Never used for a Google Places point (see pickDeep).
     * No focus: on a phone it raises the keyboard over the very choices we are offering.
     */
    function offerAreas(
      areas: Array<{ areaSlug: string; label: string; district: string; km: number }>,
      statusEl: HTMLElement | null,
      message: string,
      from: 'you' | 'there' = 'there',
    ) {
      if (areas.length === 0) {
        if (statusEl) statusEl.textContent = 'Pinned for the rider. Type your area so we can price delivery.';
        input!.focus();
        return;
      }
      if (statusEl) statusEl.textContent = message;
      lastOffer = areas.map((a) => a.areaSlug);
      current = areas.map((a) => {
        const name = a.label.split(',')[0].trim();
        return {
          label: a.label,
          district: a.district,
          area: name !== a.district ? name : undefined,
          areaSlug: a.areaSlug,
          note: a.km < 1 ? `under 1 km from ${from}` : `${a.km} km from ${from}`,
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
        pinStatus.textContent = PLUS_CODE.test(raw)
          ? 'That short Plus Code needs its full form outside Greater Kampala (e.g. 6GGJ8H7H+M5M). Copy it from Google Maps.'
          : 'That link has no readable location, the order still works without a pin.';
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
