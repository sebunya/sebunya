const STORAGE_KEY = "goldplus_anonymous_id";

function randomSafeId(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
     const bytes = new Uint8Array(16);
     crypto.getRandomValues(bytes);
     return Array.from(bytes)
       .map((byte) => byte.toString(16).padStart(2, "0"))
       .join("");
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export function getAnonymousId(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    // Enforce standardized format verification
    if (existing && /^anon_[a-zA-Z0-9_-]{12,}$/.test(existing)) {
      return existing;
    }

    const next = `anon_${randomSafeId()}`;
    window.localStorage.setItem(STORAGE_KEY, next);
    return next;
  } catch {
    return null;
  }
}
