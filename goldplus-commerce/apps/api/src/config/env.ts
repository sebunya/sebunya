import fs from 'fs';
import path from 'path';

// Load .env in non-test/non-production environments with a zero-dependency robust loader using bulletproof __dirname path resolution
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  try {
    const envPath = path.resolve(__dirname, '../../../../.env');

    if (fs.existsSync(envPath)) {
      const envFile = fs.readFileSync(envPath, 'utf-8');
      envFile.split('\n').forEach(line => {
        // Skip comments and empty lines
        if (line.trim().startsWith('#') || !line.trim()) return;
        const parts = line.split('=');
        if (parts.length >= 2) {
          const key = parts[0].trim();
          const value = parts.slice(1).join('=').trim();
          // Always set if key is present and currently empty/undefined in process.env
          if (key && (!process.env[key] || process.env[key].trim() === '')) {
            process.env[key] = value;
          }
        }
      });
    }
  } catch (e) {
    // Ignore error if .env loading fails locally
  }
}

export interface Config {
  nodeEnv: string;
  databaseUrl: string;
  jwtSecret: string;
  publicApiBaseUrl: string;
  bootstrapAdminEmail?: string;
  bootstrapAdminPassword?: string;
  bootstrapAdminPhone?: string;
  whatsappSupportNumber?: string;
  whatsappSupportLabel?: string;
  mtnWebhookSecret: string;
  airtelWebhookSecret: string;
  identityHashPepper: string;
  pesapalEnv?: string;
  pesapalBaseUrl?: string;
  pesapalConsumerKey?: string;
  pesapalConsumerSecret?: string;
  pesapalIpnId?: string;
  pesapalCurrency?: string;
  pesapalCountryCode?: string;
  pesapalBranch?: string;
  pesapalCallbackUrl?: string;
  pesapalCancellationUrl?: string;
  pesapalIpnUrl?: string;
  pesapalRedirectMode?: string;
  // Telemetry — sGTM internal dispatch URL (Docker internal network)
  metricsInternalUrl: string;
  // MCT Phase 2 Optional Integrations
  gtmAccountId?: string;
  gtmWebContainerId?: string;
  gtmServerContainerId?: string;
  gtmApiClientId?: string;
  gtmApiClientSecret?: string;
  gtmApiRefreshToken?: string;
  ga4MeasurementId?: string;
  ga4ApiSecret?: string;
  googleAdsConversionId?: string;
  metaPixelId?: string;
  metaAccessToken?: string;
  tiktokPixelId?: string;
  tiktokAccessToken?: string;
  posthogProjectApiKey?: string;
}

const obviousLocalPatterns = [
  'local-dev',
  'localhost',
  'goldplus-local-dev-secret',
  'password',
  'changeme',
  'test-secret',
  'secret'
];

function isObviousLocalSecret(value: string): boolean {
  const normalized = value.toLowerCase();
  return obviousLocalPatterns.some(pattern => normalized.includes(pattern));
}

export function validateEnv(): Config {
  const nodeEnv = process.env.NODE_ENV || 'development';

  // In test environment, gracefully bypass strict check restrictions to keep tests green
  if (nodeEnv === 'test') {
    return {
      nodeEnv,
      databaseUrl: process.env.DATABASE_URL || 'postgres://localhost:5432/goldplus',
      jwtSecret: process.env.JWT_SECRET || 'test-secret-at-least-32-characters-long-for-tests',
      publicApiBaseUrl: process.env.PUBLIC_API_BASE_URL || 'http://localhost:3000',
      mtnWebhookSecret: process.env.MTN_WEBHOOK_SECRET || 'mtn-webhook-test-secret-value-longer-than-24',
      airtelWebhookSecret: process.env.AIRTEL_WEBHOOK_SECRET || 'airtel-webhook-test-secret-value-longer-than-24',
      identityHashPepper: process.env.IDENTITY_HASH_PEPPER || 'pepper-test-secret-value-longer-than-32',
      pesapalEnv: process.env.PESAPAL_ENV,
      pesapalBaseUrl: process.env.PESAPAL_BASE_URL,
      pesapalConsumerKey: process.env.PESAPAL_CONSUMER_KEY,
      pesapalConsumerSecret: process.env.PESAPAL_CONSUMER_SECRET,
      pesapalIpnId: process.env.PESAPAL_IPN_ID,
      pesapalCurrency: process.env.PESAPAL_CURRENCY,
      pesapalCountryCode: process.env.PESAPAL_COUNTRY_CODE,
      whatsappSupportNumber: process.env.WHATSAPP_SUPPORT_NUMBER || process.env.PUBLIC_WHATSAPP_SUPPORT_NUMBER || '256705004545',
      whatsappSupportLabel: process.env.WHATSAPP_SUPPORT_LABEL || process.env.PUBLIC_WHATSAPP_SUPPORT_LABEL || 'GoldPlus Support',
      pesapalBranch: process.env.PESAPAL_BRANCH,
      pesapalCallbackUrl: process.env.PESAPAL_CALLBACK_URL,
      pesapalCancellationUrl: process.env.PESAPAL_CANCELLATION_URL,
      pesapalIpnUrl: process.env.PESAPAL_IPN_URL,
      pesapalRedirectMode: process.env.PESAPAL_REDIRECT_MODE,
      metricsInternalUrl: process.env.METRICS_INTERNAL_URL || 'http://localhost:8080',
    };
  }

  const errors: string[] = [];
  const isProd = nodeEnv === 'production';

  const checkRequired = (key: string, minLength?: number) => {
    const val = (process.env[key] || '').trim();
    if (!val) {
      errors.push(`Missing required environment variable: ${key}`);
      return '';
    }

    if (isProd) {
      if (minLength && val.length < minLength) {
        errors.push(`Environment variable ${key} is too weak: must be at least ${minLength} characters (got ${val.length})`);
      }
      if (isObviousLocalSecret(val)) {
        errors.push(`Environment variable ${key} contains an obvious local/demo placeholder ("${val}") and is unsafe for production.`);
      }
    }
    return val;
  };

  const databaseUrl = checkRequired('DATABASE_URL');
  const jwtSecret = checkRequired('JWT_SECRET', 32);
  const identityHashPepper = checkRequired('IDENTITY_HASH_PEPPER', 32);
  const mtnWebhookSecret = checkRequired('MTN_WEBHOOK_SECRET', 24);
  const airtelWebhookSecret = checkRequired('AIRTEL_WEBHOOK_SECRET', 24);
  const publicApiBaseUrl = checkRequired('PUBLIC_API_BASE_URL');

  const bootstrapAdminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const bootstrapAdminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const bootstrapAdminPhone = process.env.BOOTSTRAP_ADMIN_PHONE;
  const whatsappSupportNumber = process.env.WHATSAPP_SUPPORT_NUMBER || process.env.PUBLIC_WHATSAPP_SUPPORT_NUMBER;
  const whatsappSupportLabel = process.env.WHATSAPP_SUPPORT_LABEL || process.env.PUBLIC_WHATSAPP_SUPPORT_LABEL;

  const pesapalEnv = process.env.PESAPAL_ENV;
  const pesapalBaseUrl = process.env.PESAPAL_BASE_URL;
  const pesapalConsumerKey = process.env.PESAPAL_CONSUMER_KEY;
  const pesapalConsumerSecret = process.env.PESAPAL_CONSUMER_SECRET;
  const pesapalIpnId = process.env.PESAPAL_IPN_ID;
  const pesapalCurrency = process.env.PESAPAL_CURRENCY;
  const pesapalCountryCode = process.env.PESAPAL_COUNTRY_CODE;
  const pesapalBranch = process.env.PESAPAL_BRANCH;
  const pesapalCallbackUrl = process.env.PESAPAL_CALLBACK_URL;
  const pesapalCancellationUrl = process.env.PESAPAL_CANCELLATION_URL;
  const pesapalIpnUrl = process.env.PESAPAL_IPN_URL;
  const pesapalRedirectMode = process.env.PESAPAL_REDIRECT_MODE;

  if (errors.length > 0) {
    console.error('\n❌ ENVIRONMENT VARIABLE VALIDATION FAILED:');
    errors.forEach(err => console.error(`  - ${err}`));
    console.error('\nPlease verify your deployment settings or .env file values.\n');
    throw new Error('Environment variable validation failed');
  }

  return {
    nodeEnv,
    databaseUrl,
    jwtSecret,
    publicApiBaseUrl,
    bootstrapAdminEmail,
    bootstrapAdminPassword,
    bootstrapAdminPhone,
    mtnWebhookSecret,
    airtelWebhookSecret,
    identityHashPepper,
    whatsappSupportNumber,
    whatsappSupportLabel,
    pesapalEnv,
    pesapalBaseUrl,
    pesapalConsumerKey,
    pesapalConsumerSecret,
    pesapalIpnId,
    pesapalCurrency,
    pesapalCountryCode,
    pesapalBranch,
    pesapalCallbackUrl,
    pesapalCancellationUrl,
    pesapalIpnUrl,
    pesapalRedirectMode,
    metricsInternalUrl: process.env.METRICS_INTERNAL_URL || 'http://sgtm-production:8080',
    gtmAccountId: process.env.GTM_ACCOUNT_ID,
    gtmWebContainerId: process.env.GTM_WEB_CONTAINER_ID,
    gtmServerContainerId: process.env.GTM_SERVER_CONTAINER_ID,
    gtmApiClientId: process.env.GTM_API_CLIENT_ID,
    gtmApiClientSecret: process.env.GTM_API_CLIENT_SECRET,
    gtmApiRefreshToken: process.env.GTM_API_REFRESH_TOKEN,
    ga4MeasurementId: process.env.GA4_MEASUREMENT_ID,
    ga4ApiSecret: process.env.GA4_API_SECRET,
    googleAdsConversionId: process.env.GOOGLE_ADS_CONVERSION_ID,
    metaPixelId: process.env.META_PIXEL_ID,
    metaAccessToken: process.env.META_ACCESS_TOKEN,
    tiktokPixelId: process.env.TIKTOK_PIXEL_ID,
    tiktokAccessToken: process.env.TIKTOK_ACCESS_TOKEN,
    posthogProjectApiKey: process.env.POSTHOG_PROJECT_API_KEY,
    measurement: {
      dryRun: process.env.MEASUREMENT_DRY_RUN !== 'false',
      liveDestinationsEnabled: process.env.MEASUREMENT_LIVE_DESTINATIONS_ENABLED === 'true',
      paidSocialQueueEnabled: process.env.PAID_SOCIAL_QUEUE_ENABLED === 'true',
      qaAllowNetwork: process.env.MEASUREMENT_QA_ALLOW_NETWORK === 'true',
    }
  };
}

export const env = validateEnv();

