import crypto from "node:crypto";

/**
 * Server-side experience identity (R2, 2026-08-06).
 *
 * The browser holds ONE opaque, random, HttpOnly cookie value. The server
 * stores its SHA-256 and hangs all continuity off the resulting profile row.
 * Design rules, each load-bearing:
 *
 * - The RAW token never reaches the database, a log line, or an event row —
 *   only its hash. A database dump cannot impersonate a browser.
 * - Resolution is an UPSERT, so a wiped cookie simply begins a new profile:
 *   nothing breaks, continuity is truthfully lost (AC51).
 * - The customer link is written once and never downgraded. A profile already
 *   linked to a different verified customer is a shared or handed-over
 *   browser; the earlier authenticated truth is preserved and the collision
 *   reported, never silently overwritten (§5A.4).
 */

/**
 * Signed token contract (R9 hostile-review fix M2): `random(22) + hmac(22)`,
 * both base64url, signed with CART_CREDENTIAL_SECRET (JWT_SECRET fallback —
 * the same pair the web tier signs with). The R2 shape check alone let ANY
 * random string mint a server-side profile, which made profiles, events,
 * experiment exposures and the R8 readiness evidence writable from the public
 * internet. Now only tokens we minted resolve; everything else is rejected
 * before the database. No secret configured = no profiles (fail closed).
 */
const RANDOM_LENGTH = 22;
const SIGNATURE_LENGTH = 22;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{44}$/;

function signingSecret(): string | null {
  return process.env.CART_CREDENTIAL_SECRET || process.env.JWT_SECRET || null;
}

export function hashVisitToken(rawToken: string): string | null {
  if (!TOKEN_SHAPE.test(rawToken)) return null;
  const secret = signingSecret();
  if (!secret) return null;
  const random = rawToken.slice(0, RANDOM_LENGTH);
  const provided = rawToken.slice(RANDOM_LENGTH);
  const expected = crypto
    .createHmac("sha256", secret)
    .update(random)
    .digest("base64url")
    .slice(0, SIGNATURE_LENGTH);
  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    return null;
  }
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export interface ExperienceProfileRecord {
  id: string;
  customerId: string | null;
}

export interface IExperienceProfileRepository {
  /** Upsert by token hash; touches last_seen_at. */
  resolveOrCreate(tokenHash: string): Promise<ExperienceProfileRecord>;
  /**
   * Set customer_id if currently NULL (returns 'linked'); no-op if already
   * this customer ('already_linked'); refuse if a DIFFERENT customer holds it
   * ('conflict_preserved'). Also upserts the CUSTOMER_LOGIN identity link.
   */
  linkCustomer(tokenHash: string, customerId: string): Promise<"linked" | "already_linked" | "conflict_preserved">;
  /** Idempotent PROFILE_OBSERVED link between a profile and a legacy client anonymous id. */
  observeAnonymousId(profileId: string, anonymousId: string): Promise<void>;
}

export class ResolveExperienceProfileUseCase {
  constructor(private readonly profiles: IExperienceProfileRepository) {}

  /** Returns null (never throws) for malformed tokens — junk cannot reach the DB. */
  async execute(rawToken: string): Promise<ExperienceProfileRecord | null> {
    const tokenHash = hashVisitToken(rawToken);
    if (!tokenHash) return null;
    return this.profiles.resolveOrCreate(tokenHash);
  }
}

export class LinkExperienceProfileUseCase {
  constructor(private readonly profiles: IExperienceProfileRepository) {}

  async execute(input: {
    rawToken: string;
    customerId: string;
  }): Promise<{ status: "linked" | "already_linked" | "conflict_preserved" | "invalid_token" }> {
    const tokenHash = hashVisitToken(input.rawToken);
    if (!tokenHash) return { status: "invalid_token" };
    const status = await this.profiles.linkCustomer(tokenHash, input.customerId);
    return { status };
  }
}
