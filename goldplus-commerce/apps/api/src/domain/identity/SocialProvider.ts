/**
 * The social-provider vocabulary (0106).
 *
 * Lives in the domain so the application ports can name it without importing
 * infrastructure — the OIDC transport details belong to the adapter, but WHICH
 * providers exist is a product decision.
 */
export const SOCIAL_PROVIDERS = ['google', 'apple', 'facebook'] as const;

export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export const isSocialProvider = (value: unknown): value is SocialProvider =>
  typeof value === 'string' && (SOCIAL_PROVIDERS as readonly string[]).includes(value);

/** The API path a form_post provider (Apple) returns to; it only redirects (see formPostRelayLocation). */
export const FORM_POST_RELAY_PATH = (provider: string) => `/auth/social/${provider}/form-post`;

/**
 * Where the API sends the browser after a provider's form POST: the storefront callback, as a GET with the code and
 * the state only. Apple returns the result as a cross-site POST (response_mode=form_post, required for the name and
 * email scopes): the browser does not send the SameSite=Lax flow cookie on it, and the website's origin check
 * refuses it, so Apple sign-in could never complete. A 303 to a GET is a top-level navigation: the Lax cookie
 * travels, the origin check does not apply, and neither rule is loosened. Apple's `user` field (name, email) and
 * any id_token are NOT forwarded: the code exchange returns the verified identity, and a URL is no place for them.
 */
export function formPostRelayLocation(webBase: string, provider: string, fields: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const key of ['code', 'state', 'error'] as const) {
    const v = fields[key];
    if (typeof v === 'string' && v) params.set(key, v.slice(0, 2048));
  }
  return `${webBase.replace(/\/$/, '')}/auth/${provider}/callback${params.size ? `?${params}` : ''}`;
}
