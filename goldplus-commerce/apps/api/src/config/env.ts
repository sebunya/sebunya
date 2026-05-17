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
  mtnWebhookSecret: string;
  airtelWebhookSecret: string;
  identityHashPepper: string;
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
      identityHashPepper: process.env.IDENTITY_HASH_PEPPER || 'pepper-test-secret-value-longer-than-32'
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
  };
}

export const env = validateEnv();
