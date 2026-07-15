/// <reference types="astro/client" />
/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  readonly CONSENT_PERSISTENCE_COMMANDS_ENABLED?: string;
  readonly CONSENT_PREFERENCE_CENTRE_SAVE_ENABLED?: string;
  readonly PUBLIC_API_BASE_URL?: string;
  readonly PUBLIC_API_URL?: string;
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
