/**
 * First-party pseudonymous visitor identifier.
 *
 * This existed as a localStorage-only lookup that returned null the moment
 * storage was unavailable — private browsing, strict privacy settings, an
 * embedded webview, or storage quota exhaustion. The event tracker
 * deliberately still sends events without an id, so every one of those
 * browsers emitted a stream of unattributable events. That is the "high volume
 * of events missing anonymousId" the analytics module reports.
 *
 * The identifier is deliberately NOT a customer identity: it is random, holds
 * no personal data, never leaves this origin, and is used only to stitch a
 * recommendation impression to the click and cart action that follow it.
 *
 * Three storage tiers, degrading rather than failing:
 *
 *   PERSISTENT  localStorage   — stable across visits, the useful case
 *   SESSION     sessionStorage — stable for the tab, survives navigation
 *   EPHEMERAL   in memory      — stable for this page view only
 *
 * Every tier yields a usable id, so an event is always attributable within
 * whatever scope the browser actually permits. The tier is reported alongside
 * it so coverage can be described honestly instead of guessed at.
 */

const STORAGE_KEY = 'goldplus_anonymous_id';
const ID_PATTERN = /^anon_[a-zA-Z0-9_-]{12,}$/;

export type AnonymousIdDurability = 'PERSISTENT' | 'SESSION' | 'EPHEMERAL' | 'UNAVAILABLE';

/** Held for the life of the page when neither storage tier is writable. */
let ephemeralId: string | null = null;

function randomSafeId(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/** Reads and writes through one storage, tolerating any access failure. */
function fromStorage(store: Storage | null): string | null {
  if (!store) return null;
  try {
    const existing = store.getItem(STORAGE_KEY);
    if (existing && ID_PATTERN.test(existing)) return existing;
    const next = `anon_${randomSafeId()}`;
    store.setItem(STORAGE_KEY, next);
    // Confirm the write actually persisted: some browsers accept setItem and
    // silently discard it, which would otherwise mint a new id on every call
    // and make every event look like a different visitor.
    return store.getItem(STORAGE_KEY) === next ? next : null;
  } catch {
    return null;
  }
}

function safeStorage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export interface AnonymousIdentity {
  id: string | null;
  durability: AnonymousIdDurability;
}

/** Resolves an identifier and reports how durable it actually is. */
export function resolveAnonymousIdentity(): AnonymousIdentity {
  if (typeof window === 'undefined') {
    // Server-side rendering has no visitor to identify; the browser supplies
    // one on the events it sends.
    return { id: null, durability: 'UNAVAILABLE' };
  }

  const persistent = fromStorage(safeStorage('local'));
  if (persistent) return { id: persistent, durability: 'PERSISTENT' };

  const session = fromStorage(safeStorage('session'));
  if (session) return { id: session, durability: 'SESSION' };

  // Last resort. Attribution still works within this page view, which is far
  // better than emitting events nothing can be joined to.
  if (!ephemeralId) ephemeralId = `anon_${randomSafeId()}`;
  return { id: ephemeralId, durability: 'EPHEMERAL' };
}

export function getAnonymousId(): string | null {
  return resolveAnonymousIdentity().id;
}

/** Test seam: clears the in-memory tier between cases. */
export function __resetEphemeralAnonymousId(): void {
  ephemeralId = null;
}
