import { getRecentlyViewedLocal, type RecentlyViewedLocalItem } from "./recommendations";

const SEEN_MARKER_KEY = "goldplus_seen_before";

/**
 * SSR-safe environment check.
 */
function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/**
 * Checks if the user has been to the site in a prior session before this code executes.
 */
export function hasSeenBefore(): boolean {
  if (!isBrowser()) return false;
  try {
    return window.localStorage.getItem(SEEN_MARKER_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Writes the seen marker to localStorage so future sessions recognize them as returning.
 */
export function markSeenBefore(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(SEEN_MARKER_KEY, "true");
  } catch {
    // Silently fail closed
  }
}

/**
 * Checks whether valid recovery history exists in localStorage.
 */
export function hasRecoveryHistory(): boolean {
  if (!isBrowser()) return false;
  const items = getRecentlyViewedHistory();
  return items.length > 0;
}

/**
 * Fetches user's historical activity.
 */
export function getRecentlyViewedHistory(): RecentlyViewedLocalItem[] {
  return getRecentlyViewedLocal();
}

/**
 * Central gate determining whether to display Pick Up Where You Left Off.
 * Criteria: Prior marker existed AND they have valid history.
 */
export function shouldShowPickUpWhereYouLeftOff(): boolean {
  // Short-circuit if server-rendering
  if (!isBrowser()) return false;
  
  const wasSeen = hasSeenBefore();
  const hasHistory = hasRecoveryHistory();
  
  return wasSeen && hasHistory;
}

/**
 * Convenience helper executed on application load to process current visit states.
 * Ensures new visitors become returning visitors on subsequent navigation.
 */
export function handleUserVisitState(): void {
  if (!isBrowser()) return;
  // If they aren't recognized yet, mark them so future visits consider them returning.
  if (!hasSeenBefore()) {
    markSeenBefore();
  }
}
