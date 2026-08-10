import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * IntegrationCredentialVault — AES-256-GCM encryption for SEO integration
 * credentials.
 *
 * Key derivation: sha256 of SEO_CREDENTIAL_VAULT_KEY when set, otherwise the
 * app's primary secret JWT_SECRET (always via the labelled derivation below,
 * mirroring cartCredential/checkoutIntent house style) — so no new env var is
 * strictly required, but a dedicated vault key can be rotated independently.
 *
 * Ciphertext wire format: base64(iv).base64(authTag).base64(data) — three
 * dot-separated base64 segments. Plaintext NEVER touches the database; only
 * ciphertext plus a 4-char display mask are stored.
 */

const DERIVATION_LABEL = 'goldplus:seo-integration-credential-vault:v1';

export class IntegrationCredentialVault {
  private readonly key: Buffer;

  constructor(secret?: string, env: Record<string, string | undefined> = process.env) {
    const material = (secret ?? env.SEO_CREDENTIAL_VAULT_KEY ?? env.JWT_SECRET ?? '').trim();
    if (material === '') {
      throw new Error('IntegrationCredentialVault requires SEO_CREDENTIAL_VAULT_KEY or JWT_SECRET.');
    }
    this.key = createHash('sha256').update(`${DERIVATION_LABEL}:${material}`).digest();
  }

  /** Build from env; returns null when no secret material exists (honest no-op path). */
  static fromEnv(env: Record<string, string | undefined> = process.env): IntegrationCredentialVault | null {
    const material = (env.SEO_CREDENTIAL_VAULT_KEY ?? env.JWT_SECRET ?? '').trim();
    return material === '' ? null : new IntegrationCredentialVault(material);
  }

  /** Encrypt a JSON-serialisable secret payload. */
  encrypt(payload: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${tag.toString('base64')}.${data.toString('base64')}`;
  }

  /** Decrypt; throws on tampering or a wrong key (GCM auth). */
  decrypt<T = unknown>(ciphertext: string): T {
    const parts = ciphertext.split('.');
    if (parts.length !== 3) throw new Error('Malformed vault ciphertext.');
    const [iv, tag, data] = parts.map((p) => Buffer.from(p, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(plain.toString('utf8')) as T;
  }
}

/**
 * Display mask for a stored credential: '••••' + at most the last 4 chars of a
 * NON-SENSITIVE fingerprint. For service-account JSON the fingerprint is the
 * client_email local part (identity, not key material); for everything else a
 * sha256 fingerprint of the secret — so the mask never reveals actual secret
 * characters beyond 0 of the key material itself for JSON, and 0 raw chars at
 * all for opaque secrets.
 */
export function maskOf(secret: unknown): string {
  let fingerprint: string | null = null;
  const asObject = (v: unknown): Record<string, unknown> | null => {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
      } catch { return null; }
    }
    return null;
  };
  const obj = asObject(secret);
  const clientEmail = obj && typeof obj.client_email === 'string' ? obj.client_email : null;
  if (clientEmail && clientEmail.includes('@')) {
    fingerprint = clientEmail.split('@')[0];
  } else {
    const raw = typeof secret === 'string' ? secret : JSON.stringify(secret ?? '');
    fingerprint = createHash('sha256').update(raw).digest('hex').toUpperCase();
  }
  return `••••${fingerprint.slice(-4).toUpperCase()}`;
}
