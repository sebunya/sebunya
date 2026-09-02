/// <reference types="astro/client" />
/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  readonly CONSENT_PERSISTENCE_COMMANDS_ENABLED?: string;
  readonly CONSENT_PREFERENCE_CENTRE_SAVE_ENABLED?: string;
  readonly PUBLIC_API_BASE_URL?: string;
  readonly PUBLIC_GTM_ID?: string;
  readonly PUBLIC_METRICS_URL?: string;
  readonly PUBLIC_POSTHOG_HOST?: string;
  readonly PUBLIC_POSTHOG_KEY?: string;
  readonly PUBLIC_WHATSAPP_SUPPORT_LABEL?: string;
  readonly PUBLIC_WHATSAPP_SUPPORT_NUMBER?: string;
  readonly WHATSAPP_SUPPORT_LABEL?: string;
  readonly WHATSAPP_SUPPORT_NUMBER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    /** The raw opaque visit token from the HttpOnly gp_visit cookie (R2). SSR-only; never serialize into HTML. */
    gpVisit?: string;
    /** True only on the first-ever document request from this browser (cookie just minted). */
    gpVisitIsNew?: boolean;
    /**
     * The cart credential for this request, resolved in middleware because
     * minting one sets a cookie and a component renders too late to do that.
     */
    gpCart?: { token: string; cartId: string; fresh: boolean } | null;
    /** The signed-in customer for this request, resolved once per render. */
    gpUserId?: string | null;
  }
}
