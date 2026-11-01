import crypto from "node:crypto";

/**
 * Signed visit tokens (R9 hostile-review fix M2 — unforgeable identity).
 *
 * The R2 token was random-but-unverifiable: any string matching the shape
 * regex minted a server-side profile on first use, which made profiles,
 * events, experiment exposures — and therefore the R8 model-readiness
 * evidence — writable from the public internet at the cost of a random
 * number. A token is now `random(22) + hmac(random)(22)`, so only tokens WE
 * minted resolve to profiles; everything else is rejected before the
 * database.
 *
 * The secret is CART_CREDENTIAL_SECRET (already present in both the web and
 * api containers — the same secret the signed cart credential uses), with
 * JWT_SECRET as the fallback, mirroring lib/cartCredential.ts.
 */

const RANDOM_LENGTH = 22; // 16 bytes, base64url, no padding
const SIGNATURE_LENGTH = 22;

function signingSecret(): string | null {
  const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  return (
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.CART_CREDENTIAL_SECRET ||
    env.CART_CREDENTIAL_SECRET ||
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.JWT_SECRET ||
    env.JWT_SECRET ||
    null
  );
}

function signature(random: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(random).digest("base64url").slice(0, SIGNATURE_LENGTH);
}

/** Mints a signed token, or null when no secret is configured (the visitor simply gets no continuity — nothing breaks). */
export function mintSignedVisitToken(): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  const random = crypto.randomBytes(16).toString("base64url");
  return `${random}${signature(random, secret)}`;
}

/** True only for a token this deployment's secret signed. */
export function isSignedVisitToken(raw: string | undefined | null): raw is string {
  if (!raw || raw.length !== RANDOM_LENGTH + SIGNATURE_LENGTH) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return false;
  const secret = signingSecret();
  if (!secret) return false;
  const random = raw.slice(0, RANDOM_LENGTH);
  const provided = raw.slice(RANDOM_LENGTH);
  const expected = signature(random, secret);
  return (
    provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  );
}
