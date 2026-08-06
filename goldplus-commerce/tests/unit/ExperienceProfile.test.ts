import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  hashVisitToken,
  ResolveExperienceProfileUseCase,
  LinkExperienceProfileUseCase,
  type IExperienceProfileRepository,
} from "../../apps/api/src/application/use-cases/identity/ExperienceProfileUseCases";

/**
 * R2 (2026-08-06): the server-side experience identity. The storefront's only
 * browser state is one opaque HttpOnly cookie; everything meaningful hangs off
 * the server profile row. These pins hold the §5A architecture closed.
 */

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// R9: tokens are HMAC-signed — only tokens WE minted resolve. The suite signs
// with a test secret exactly the way the web middleware does.
process.env.CART_CREDENTIAL_SECRET = process.env.CART_CREDENTIAL_SECRET || "test-visit-secret";
const crypto = await import("node:crypto");
function signedToken(): string {
  const random = crypto.randomBytes(16).toString("base64url");
  const sig = crypto
    .createHmac("sha256", process.env.CART_CREDENTIAL_SECRET!)
    .update(random)
    .digest("base64url")
    .slice(0, 22);
  return `${random}${sig}`;
}

class FakeProfiles implements IExperienceProfileRepository {
  rows = new Map<string, { id: string; customerId: string | null }>();
  observed: Array<{ profileId: string; anonymousId: string }> = [];
  private seq = 0;

  async resolveOrCreate(tokenHash: string) {
    const existing = this.rows.get(tokenHash);
    if (existing) return existing;
    const created = { id: `profile-${++this.seq}`, customerId: null };
    this.rows.set(tokenHash, created);
    return created;
  }

  async linkCustomer(tokenHash: string, customerId: string) {
    const profile = await this.resolveOrCreate(tokenHash);
    if (profile.customerId === null) {
      profile.customerId = customerId;
      return "linked" as const;
    }
    if (profile.customerId === customerId) return "already_linked" as const;
    return "conflict_preserved" as const;
  }

  async observeAnonymousId(profileId: string, anonymousId: string) {
    this.observed.push({ profileId, anonymousId });
  }
}

describe("the opaque token contract", () => {
  it("hashes a SIGNED token to a fixed-length hex digest — the raw value never persists", () => {
    const hash = hashVisitToken(signedToken());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects junk AND well-shaped-but-unsigned tokens before the database (R9 M2)", () => {
    for (const junk of ["", "short", "a".repeat(200), "has spaces here padded", "semi;colon-injection-x", "ünïcödé-tokens-rejected"]) {
      expect(hashVisitToken(junk), junk).toBeNull();
    }
    // The R2 bypass: a random string of the right SHAPE used to mint a
    // profile. Shape alone no longer resolves — the signature must verify.
    expect(hashVisitToken("A".repeat(44))).toBeNull();
    const tampered = signedToken().slice(0, 43) + (signedToken().endsWith("A") ? "B" : "A");
    expect(hashVisitToken(tampered)).toBeNull();
  });

  it("resolution returns null for malformed tokens instead of throwing", async () => {
    const useCase = new ResolveExperienceProfileUseCase(new FakeProfiles());
    expect(await useCase.execute("!!!not-a-token!!!")).toBeNull();
  });

  it("the same token resolves to the same profile; a new token begins a new one (AC51)", async () => {
    const repo = new FakeProfiles();
    const useCase = new ResolveExperienceProfileUseCase(repo);
    const tokenA = signedToken();
    const tokenB = signedToken();
    const a1 = await useCase.execute(tokenA);
    const a2 = await useCase.execute(tokenA);
    const b = await useCase.execute(tokenB);
    expect(a1!.id).toBe(a2!.id);
    expect(b!.id).not.toBe(a1!.id);
  });
});

describe("the login merge — idempotent, never a downgrade (AC52, §5A.4)", () => {
  it("links an unclaimed profile, is a no-op on repeat, and PRESERVES a different customer's claim", async () => {
    const repo = new FakeProfiles();
    const link = new LinkExperienceProfileUseCase(repo);
    const token = signedToken();

    expect((await link.execute({ rawToken: token, customerId: "cust-1" })).status).toBe("linked");
    expect((await link.execute({ rawToken: token, customerId: "cust-1" })).status).toBe("already_linked");
    // A second verified customer on the same browser: the FIRST authenticated
    // truth holds. Silent overwrite is how a family tablet merges two people.
    expect((await link.execute({ rawToken: token, customerId: "cust-2" })).status).toBe("conflict_preserved");
    expect(repo.rows.get(hashVisitToken(token)!)!.customerId).toBe("cust-1");
  });

  it("rejects malformed tokens without touching the repository", async () => {
    const repo = new FakeProfiles();
    const link = new LinkExperienceProfileUseCase(repo);
    expect((await link.execute({ rawToken: "bad token", customerId: "cust-1" })).status).toBe("invalid_token");
    expect(repo.rows.size).toBe(0);
  });
});

describe("repository contract pins (the SQL that makes the guarantees real)", () => {
  const repo = read("apps/api/src/infrastructure/db/repositories/DrizzleExperienceProfileRepository.ts");

  it("linkCustomer claims the profile with a conditional write — the race re-checks NULL inside the transaction", () => {
    expect(repo).toContain("isNull(experienceProfiles.customerId)");
    expect(repo).toContain("db.transaction");
  });

  it("the anonymous-id stitch upserts against the partial unique index", () => {
    expect(repo).toContain("on conflict (profile_id, anonymous_id) where link_type = 'PROFILE_OBSERVED'");
  });

  it("a conflict is RECORDED (CUSTOMER_LOGIN_CONFLICT), not just swallowed", () => {
    expect(repo).toContain("CUSTOMER_LOGIN_CONFLICT");
  });
});

describe("migration 0100 — additive, reversible, no inserts", () => {
  it("creates experience_profiles, adds identity_links.profile_id, and both partial unique indexes", () => {
    const migration = read("apps/api/src/infrastructure/db/migrations/0100_experience_profiles.sql");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "experience_profiles"');
    expect(migration).toContain('ALTER TABLE "identity_links" ADD COLUMN IF NOT EXISTS "profile_id"');
    expect(migration).toContain('"identity_links_profile_anon_uq"');
    expect(migration).toContain('"identity_links_profile_customer_uq"');
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(read("apps/api/src/infrastructure/db/migrations/meta/_journal.json")).toContain('"tag": "0100_experience_profiles"');
  });
});

describe("the browser holds ONLY an opaque locator (AC48/AC49)", () => {
  it("the middleware mints an HttpOnly, SameSite=Lax, 180-day, SIGNED cookie", () => {
    const mw = read("apps/web/src/middleware.ts");
    expect(mw).toContain('httpOnly: true');
    expect(mw).toContain('sameSite: "lax"');
    expect(mw).toContain("180 * 24 * 60 * 60");
    // R9 M2: minting and verification go through the signed-token lib —
    // an unsigned or fabricated cookie is replaced, never trusted.
    expect(mw).toContain("mintSignedVisitToken");
    expect(mw).toContain("isSignedVisitToken");
  });

  it("the same-origin relay is an allowlist: one path, POST only, size-capped, token attached server-side", () => {
    const relay = read("apps/web/src/pages/api/rec/[...path].ts");
    expect(relay).toContain('!== "events"');
    expect(relay).toContain("MAX_BODY_BYTES");
    expect(relay).toContain('headers["x-gp-visit"] = visit');
    expect(relay).toContain("METHOD_NOT_ALLOWED");
  });

  it("browser events go to the SAME ORIGIN — no cross-origin dependency for capture (AC57)", () => {
    const lib = read("apps/web/src/lib/recommendations.ts");
    expect(lib).toContain('const endpoint = "/api/rec/events"');
    expect(lib).not.toContain("navigator.sendBeacon(`${apiBase}");
  });

  it("the raw visit token is never serialized into HTML — SSR passes it as a fetch header only", () => {
    const lib = read("apps/web/src/lib/recommendations.ts");
    expect(lib).toContain('headers["x-gp-visit"] = options.visitToken');
    for (const rail of [
      "apps/web/src/components/recommendations/RelatedProductsRail.astro",
      "apps/web/src/components/recommendations/CompleteSetupRail.astro",
      "apps/web/src/components/recommendations/CartAddonRail.astro",
      "apps/web/src/components/recommendations/PopularNowRail.astro",
      "apps/web/src/components/recommendations/CategoryPopularRail.astro",
    ]) {
      const src = read(rail);
      expect(src, rail).toContain("visitToken: Astro.locals.gpVisit");
      // The token must never appear in a template expression or data attribute.
      expect(src, rail).not.toMatch(/data-[a-z-]*visit/);
    }
  });

  it("login and registration both merge the profile after auth, fire-and-forget", () => {
    for (const page of ["apps/web/src/pages/login.astro", "apps/web/src/pages/register.astro"]) {
      const src = read(page);
      expect(src, page).toContain("/recommendations/profile/link");
      expect(src, page).toContain("AbortSignal.timeout(3000)");
    }
  });
});
