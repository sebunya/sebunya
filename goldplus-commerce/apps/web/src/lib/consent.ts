/**
 * MEASUREMENT CONTROL TOWER — BROWSER CONSENT SDK
 *
 * The only file that manages consent state in the browser.
 * Provides:
 * - Cookie banner integration (show/hide based on consent state)
 * - Consent signal capture and API submission
 * - Telemetry gating (do not fire events without the appropriate consent)
 * - GDPR-compliant withdrawal support
 *
 * DESIGN INVARIANTS:
 * 1. Commerce functionality (cart, checkout, payment) is NEVER gated by consent.
 * 2. Consent defaults to all-denied until explicitly granted.
 * 3. Consent state is persisted in localStorage for fast reads without API calls.
 * 4. Essential purpose is always granted (cannot be denied).
 * 5. All consent decisions are submitted server-side for audit trail storage.
 */

declare const __GP_API_BASE__: string;
const API_BASE: string = typeof __GP_API_BASE__ !== 'undefined'
  ? __GP_API_BASE__
  : window.location.origin;

const CONSENT_SIGNAL_ENDPOINT  = `${API_BASE}/consent/signal`;
const CONSENT_STATUS_ENDPOINT  = `${API_BASE}/consent/status`;
const CONSENT_WITHDRAW_ENDPOINT = `${API_BASE}/consent/withdraw`;

const CONSENT_STORAGE_KEY   = '_gp_consent_state';
const CONSENT_BANNER_SHOWN  = '_gp_consent_banner_shown';
const CONSENT_VERSION       = 'v1.0'; // Bump on material notice changes

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ConsentState {
  analytics:       boolean;
  advertising:     boolean;
  personalization: boolean;
  essential:       true;
}

export type ConsentPurpose = 'analytics' | 'advertising' | 'personalization';

// ─────────────────────────────────────────────────────────────────────────────
// Local State (in-memory cache synced with localStorage)
// ─────────────────────────────────────────────────────────────────────────────

let _consentState: ConsentState | null = null;

/**
 * Returns the default deny-all consent state.
 * Essential is always granted — this cannot be changed.
 */
function defaultState(): ConsentState {
  return {
    essential:       true,
    analytics:       false,
    advertising:     false,
    personalization: false,
  };
}

/**
 * Attempt to load consent state from localStorage.
 * Returns null if no valid consent has been recorded yet (pre-banner).
 */
function loadFromStorage(): ConsentState | null {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return {
      essential:       true,
      analytics:       Boolean(parsed.analytics),
      advertising:     Boolean(parsed.advertising),
      personalization: Boolean(parsed.personalization),
    };
  } catch {
    return null;
  }
}

function persistToStorage(state: ConsentState): void {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore if storage unavailable */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize consent SDK. Call once at application startup.
 * Loads existing consent from localStorage.
 */
export function initConsent(): ConsentState {
  _consentState = loadFromStorage() ?? defaultState();
  return _consentState;
}

/**
 * Get current in-memory consent state.
 * Falls back to localStorage → default.
 */
export function getConsentState(): ConsentState {
  if (_consentState) return _consentState;
  return initConsent();
}

/**
 * Check if a specific purpose is granted.
 * Essential always returns true.
 */
export function isPurposeGranted(purpose: ConsentPurpose | 'essential'): boolean {
  if (purpose === 'essential') return true;
  return getConsentState()[purpose];
}

/**
 * Returns true if the consent banner has not been shown yet.
 * Use this to decide whether to render the banner on page load.
 */
export function shouldShowConsentBanner(): boolean {
  try {
    return !localStorage.getItem(CONSENT_BANNER_SHOWN);
  } catch {
    return true;
  }
}

/**
 * Grant all measurement purposes (Accept All).
 * Persists locally and submits to API for audit trail.
 */
export async function grantAllConsent(opts?: { fpClientId?: string; userId?: string }): Promise<ConsentState> {
  const state: ConsentState = {
    essential:       true,
    analytics:       true,
    advertising:     true,
    personalization: true,
  };

  _consentState = state;
  persistToStorage(state);
  markBannerShown();

  await submitConsentSignal(state, 'explicit', 'cookie_banner', opts);
  return state;
}

/**
 * Grant only essential consent (Reject All / Necessary Only).
 */
export async function rejectAllNonEssential(opts?: { fpClientId?: string; userId?: string }): Promise<ConsentState> {
  const state: ConsentState = {
    essential:       true,
    analytics:       false,
    advertising:     false,
    personalization: false,
  };

  _consentState = state;
  persistToStorage(state);
  markBannerShown();

  await submitConsentSignal(state, 'explicit', 'cookie_banner', opts);
  return state;
}

/**
 * Grant specific purposes (from preferences panel).
 */
export async function grantCustomConsent(
  purposes: Partial<Record<ConsentPurpose, boolean>>,
  opts?: { fpClientId?: string; userId?: string },
): Promise<ConsentState> {
  const current = getConsentState();
  const state: ConsentState = {
    essential:       true,
    analytics:       purposes.analytics       ?? current.analytics,
    advertising:     purposes.advertising     ?? current.advertising,
    personalization: purposes.personalization ?? current.personalization,
  };

  _consentState = state;
  persistToStorage(state);
  markBannerShown();

  await submitConsentSignal(state, 'explicit', 'privacy_settings', opts);
  return state;
}

/**
 * Withdraw consent for specific purposes.
 * Commerce functionality is unaffected.
 */
export async function withdrawConsent(
  purposes: ConsentPurpose[],
  opts?: { fpClientId?: string; userId?: string },
): Promise<void> {
  const current = getConsentState();
  const updated: ConsentState = { ...current, essential: true };

  for (const p of purposes) {
    updated[p] = false;
  }

  _consentState = updated;
  persistToStorage(updated);

  if (!opts?.fpClientId) return;

  await fetch(CONSENT_WITHDRAW_ENDPOINT, {
    method:    'POST',
    headers:   { 'Content-Type': 'application/json' },
    body:      JSON.stringify({
      fp_client_id: opts.fpClientId,
      user_id:      opts.userId,
      purposes,
    }),
    keepalive: true,
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function markBannerShown(): void {
  try {
    localStorage.setItem(CONSENT_BANNER_SHOWN, '1');
  } catch { /* ignore */ }
}

async function submitConsentSignal(
  state: ConsentState,
  grantType: string,
  surface: string,
  opts?: { fpClientId?: string; userId?: string },
): Promise<void> {
  if (!opts?.fpClientId) return; // Need at least fp_client_id to submit

  const payload = {
    fp_client_id:    opts.fpClientId,
    user_id:         opts.userId,
    purposes:        state,
    grant_type:      grantType,
    capture_surface: surface,
    consent_language: navigator.language?.slice(0, 2) || 'en',
    notice_version:  CONSENT_VERSION,
    consent_at:      Math.floor(Date.now() / 1000),
  };

  await fetch(CONSENT_SIGNAL_ENDPOINT, {
    method:    'POST',
    headers:   { 'Content-Type': 'application/json' },
    body:      JSON.stringify(payload),
    keepalive: true,
  }).catch((err) => {
    // Non-fatal — consent state is already persisted locally
    console.warn('[GoldPlus Consent] Failed to submit consent signal to API:', err);
  });
}
