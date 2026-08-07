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
