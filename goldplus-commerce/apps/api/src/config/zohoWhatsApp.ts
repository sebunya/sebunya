/**
 * Zoho CPaaS WhatsApp configuration: the ONE place its environment is read.
 *
 * Zoho CPaaS (formerly ZeptoMail) exposes a single template-send endpoint,
 * `POST https://cpaas.zoho.com/v1.1/whatsapp`, authenticated with an Agent's
 * Send API key in the Authorization header. There is no OAuth flow, so there is
 * no token to refresh or cache. See docs/notifications/whatsapp-zoho.md.
 *
 * Pure: takes an env snapshot, returns a value. No network, no logging, and the
 * API key never leaves this object except as the Authorization header value.
 */

export const ZOHO_WHATSAPP_DEFAULT_BASE_URL = 'https://cpaas.zoho.com/v1.1/whatsapp';
export const ZOHO_WHATSAPP_DEFAULT_TIMEOUT_MS = 10000;

/** Env prefix for each Zoho template key: ZOHO_WHATSAPP_TEMPLATE_<OUR_TEMPLATE>. */
export const ZOHO_WHATSAPP_TEMPLATE_ENV_PREFIX = 'ZOHO_WHATSAPP_TEMPLATE_';

export interface ZohoWhatsAppConfig {
  apiKey: string;
  /** The WABA sender number, digits only with country code (e.g. 256705004545). */
  fromNumber: string;
  baseUrl: string;
  timeoutMs: number;
  /** Credentials, sender and base URL all present and well-formed. */
  configured: boolean;
  /** Human-readable problems, never containing a value. */
  problems: string[];
}

export function readZohoWhatsAppConfig(env: NodeJS.ProcessEnv = process.env): ZohoWhatsAppConfig {
  const apiKey = (env.ZOHO_WHATSAPP_API_KEY || '').trim();
  const fromRaw = (env.ZOHO_WHATSAPP_FROM_NUMBER || '').trim();
  const fromNumber = fromRaw.replace(/[\s\-()+]/g, '');
  const baseUrl = (env.ZOHO_WHATSAPP_BASE_URL || ZOHO_WHATSAPP_DEFAULT_BASE_URL).trim();
  const timeoutRaw = (env.ZOHO_WHATSAPP_TIMEOUT_MS || '').trim();
  const timeoutParsed = timeoutRaw ? Number(timeoutRaw) : ZOHO_WHATSAPP_DEFAULT_TIMEOUT_MS;

  const problems: string[] = [];
  if (!apiKey) problems.push('ZOHO_WHATSAPP_API_KEY is not set.');
  if (!fromRaw) problems.push('ZOHO_WHATSAPP_FROM_NUMBER is not set.');
  else if (!/^\d{10,15}$/.test(fromNumber)) {
    problems.push('ZOHO_WHATSAPP_FROM_NUMBER must be the full number with country code, digits only (e.g. 2567XXXXXXXX).');
  }
  if (!/^https:\/\/[^\s/]+\//.test(baseUrl)) problems.push('ZOHO_WHATSAPP_BASE_URL must be an https URL.');
  const timeoutValid = Number.isInteger(timeoutParsed) && timeoutParsed >= 1000 && timeoutParsed <= 60000;
  if (!timeoutValid) problems.push('ZOHO_WHATSAPP_TIMEOUT_MS must be a whole number of milliseconds between 1000 and 60000.');

  return {
    apiKey,
    fromNumber,
    baseUrl,
    timeoutMs: timeoutValid ? timeoutParsed : ZOHO_WHATSAPP_DEFAULT_TIMEOUT_MS,
    configured: problems.length === 0,
    problems,
  };
}

/** The Zoho template key the owner pasted for one of our templates, or null. */
export function zohoTemplateKeyFor(template: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const key = (env[`${ZOHO_WHATSAPP_TEMPLATE_ENV_PREFIX}${template.trim().toUpperCase()}`] || '').trim();
  return key || null;
}

/**
 * Startup check. Returns warnings for a HALF-configured channel only: nothing set
 * is the normal "Not configured" state and says nothing; some values set but
 * others missing or malformed is an operator mistake worth a line in the log.
 * Never throws — a WhatsApp typo must not stop the shop from booting; the adapter
 * already refuses to send on an unusable configuration.
 */
export function zohoWhatsAppStartupWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  const anySet = Object.keys(env).some((k) => k.startsWith('ZOHO_WHATSAPP_') && (env[k] || '').trim() !== '');
  const enabled = (env.NOTIFICATIONS_WHATSAPP_ENABLED || '').trim().toLowerCase() === 'true';
  if (!anySet && !enabled) return [];
  const cfg = readZohoWhatsAppConfig(env);
  const warnings = [...cfg.problems];
  if (enabled && cfg.configured) {
    const mapped = Object.keys(env).some(
      (k) => k.startsWith(ZOHO_WHATSAPP_TEMPLATE_ENV_PREFIX) && (env[k] || '').trim() !== '',
    );
    if (!mapped) warnings.push('NOTIFICATIONS_WHATSAPP_ENABLED is true but no ZOHO_WHATSAPP_TEMPLATE_* key is set, so nothing can be sent on WhatsApp.');
  }
  return warnings;
}
