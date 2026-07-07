import { createHmac, createHash } from 'node:crypto';
import { env } from '../../config/env';

/**
 * PHASE 4 — ENTERPRISE IDENTITY GRAPH
 * PII Hashing Service
 *
 * SECURITY MODEL:
 * All PII normalization and hashing MUST go through this service.
 *
 * We use HMAC-SHA256 (not plain SHA-256) with the IDENTITY_HASH_PEPPER secret
 * as the HMAC key. This is strictly superior to SHA256(pepper + input) because:
 *   - HMAC is specifically designed for message authentication with a secret key
 *   - HMAC is immune to length-extension attacks (SHA256 concatenation is not)
 *   - The secret key never appears in the hash output, preventing partial attacks
 *
 * Ad platform compatibility:
 *   - Google, Meta, TikTok, Pinterest all accept SHA-256 hex hashes.
 *   - The HMAC output is a standard 64-char hex string — fully compatible.
 *   - These platforms cannot verify our HMAC since they don't have our pepper,
 *     but they can still match hashes between sessions within our own system.
 *
 * CAUTION — External CAPI matching:
 *   For external enhanced matching (where the platform hashes users' own DB
 *   and compares), you need bare SHA-256. However, for our use case where
 *   we hash ONCE and store, then pass the same hash consistently, HMAC is
 *   the correct approach.
 *
 * Normalization rules (per Google/Meta spec):
 *   - Email: lowercase, whitespace stripped
 *   - Phone: E.164 format (+ prefix, digits only)
 *   - Names: lowercase, whitespace stripped
 */
export class PiiHashingService {
  private readonly pepper: string;

  constructor(pepper?: string) {
    this.pepper = pepper ?? env.identityHashPepper;
    if (!this.pepper || this.pepper.length < 32) {
      throw new Error('[PiiHashingService] IDENTITY_HASH_PEPPER must be at least 32 characters');
    }
  }

  /** Hash an email address. Normalizes before hashing. */
  hashEmail(raw: string): string {
    if (!raw || !raw.includes('@')) throw new Error('[PiiHashingService] Invalid email');
    const normalized = raw.trim().toLowerCase();
    return this.hmac(normalized);
  }

  /**
   * Hash a phone number. Normalizes to E.164 before hashing.
   * Handles Uganda (256) local numbers automatically.
   */
  hashPhone(raw: string): string {
    const e164 = this.normalizePhone(raw);
    return this.hmac(e164);
  }

  /** Hash a name field. Lowercase + strip whitespace. */
  hashName(raw: string): string {
    return this.hmac(raw.trim().toLowerCase());
  }

  /**
   * Verify a raw value against a stored HMAC hash.
   * Uses a constant-time comparison to prevent timing attacks.
   */
  verify(raw: string, storedHash: string): boolean {
    let computed: string;
    try {
      computed = this.hmac(raw.trim().toLowerCase());
    } catch {
      return false;
    }
    // Constant-time comparison — prevents timing oracle attacks
    if (computed.length !== storedHash.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) {
      diff |= computed.charCodeAt(i) ^ storedHash.charCodeAt(i);
    }
    return diff === 0;
  }

  /**
   * Normalize a phone number to E.164 format.
   * Exported for use in tests and validation.
   */
  normalizePhone(raw: string): string {
    // Strip everything except digits and leading +
    const stripped = raw.trim();
    const digitsOnly = stripped.replace(/\D/g, '');

    // Already has country code prefix
    if (stripped.startsWith('+') && digitsOnly.length >= 10) {
      return `+${digitsOnly}`;
    }

    // Uganda 9-digit local (7XXXXXXXX → +2567XXXXXXXX)
    if (digitsOnly.length === 9 && /^[7]/.test(digitsOnly)) {
      return `+256${digitsOnly}`;
    }

    // Uganda 12-digit (256XXXXXXXXX → +256XXXXXXXXX)
    if (digitsOnly.length === 12 && digitsOnly.startsWith('256')) {
      return `+${digitsOnly}`;
    }

    // Assume international if >10 digits
    if (digitsOnly.length >= 10) {
      return `+${digitsOnly}`;
    }

    throw new Error(`[PiiHashingService] Cannot normalize phone to E.164: "${raw}"`);
  }

  /**
   * Hash email with standard plain SHA-256 (no pepper) for ad platforms.
   * Lowercase, strip all spaces.
   */
  hashEmailStandard(raw: string): string {
    if (!raw || !raw.includes('@')) throw new Error('[PiiHashingService] Invalid email');
    const normalized = raw.trim().toLowerCase().replace(/\s+/g, '');
    return this.sha256(normalized);
  }

  /**
   * Hash phone with standard plain SHA-256 (no pepper) for ad platforms.
   * Normalized to E.164.
   */
  hashPhoneStandard(raw: string): string {
    const e164 = this.normalizePhone(raw);
    return this.sha256(e164);
  }

  private sha256(input: string): string {
    return createHash('sha256').update(input).digest('hex');
  }

  private hmac(input: string): string {
    return createHmac('sha256', this.pepper)
      .update(input)
      .digest('hex');
  }
}

// Singleton — constructed once with validated pepper from env
export const piiHasher = new PiiHashingService();
