import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../client";
import { experienceProfiles } from "../schema/experience";
import { identityLinks } from "../schema/identity";
import type {
  ExperienceProfileRecord,
  IExperienceProfileRepository,
} from "../../../application/use-cases/identity/ExperienceProfileUseCases";

export class DrizzleExperienceProfileRepository implements IExperienceProfileRepository {
  async resolveOrCreate(tokenHash: string): Promise<ExperienceProfileRecord> {
    const rows = await db
      .insert(experienceProfiles)
      .values({ tokenHash })
      .onConflictDoUpdate({
        target: experienceProfiles.tokenHash,
        set: { lastSeenAt: sql`now()` },
      })
      .returning({ id: experienceProfiles.id, customerId: experienceProfiles.customerId });
    return rows[0];
  }

  async linkCustomer(tokenHash: string, customerId: string): Promise<"linked" | "already_linked" | "conflict_preserved"> {
    return db.transaction(async (tx) => {
      // Ensure the profile exists (a first-ever visit may link on the same request).
      const profileRows = await tx
        .insert(experienceProfiles)
        .values({ tokenHash })
        .onConflictDoUpdate({ target: experienceProfiles.tokenHash, set: { lastSeenAt: sql`now()` } })
        .returning({ id: experienceProfiles.id, customerId: experienceProfiles.customerId });
      const profile = profileRows[0];

      let status: "linked" | "already_linked" | "conflict_preserved";
      if (profile.customerId === null) {
        // Conditional write: only claims a still-unlinked row, so two racing
        // logins cannot both win — the WHERE re-checks NULL inside the tx.
        const updated = await tx
          .update(experienceProfiles)
          .set({ customerId, customerLinkedAt: sql`now()`, lastSeenAt: sql`now()` })
          .where(and(eq(experienceProfiles.id, profile.id), isNull(experienceProfiles.customerId)))
          .returning({ id: experienceProfiles.id });
        status = updated.length > 0 ? "linked" : "conflict_preserved";
        if (updated.length === 0) {
          // Lost the race — re-read to see whether the winner was this same customer.
          const current = await tx
            .select({ customerId: experienceProfiles.customerId })
            .from(experienceProfiles)
            .where(eq(experienceProfiles.id, profile.id));
          if (current[0]?.customerId === customerId) status = "already_linked";
        }
      } else if (profile.customerId === customerId) {
        status = "already_linked";
      } else {
        // A different verified customer already owns this browser profile.
        // First authenticated truth holds (§5A.4) — preserved, never overwritten.
        status = "conflict_preserved";
      }

      if (status !== "conflict_preserved") {
        // Idempotent via identity_links_profile_customer_uq.
        await tx
          .insert(identityLinks)
          .values({
            profileId: profile.id,
            customerId,
            linkType: "CUSTOMER_LOGIN",
            linkConfidence: 100,
            lastSeenAt: sql`now()` as never,
          })
          .onConflictDoNothing();
      } else {
        // The collision itself is a recorded observation (no unique index —
        // each collision event is a fact), bounded by login frequency.
        await tx.insert(identityLinks).values({
          profileId: profile.id,
          customerId,
          linkType: "CUSTOMER_LOGIN_CONFLICT",
          linkConfidence: 0,
          lastSeenAt: sql`now()` as never,
        });
      }

      return status;
    });
  }

  async observeAnonymousId(profileId: string, anonymousId: string): Promise<void> {
    // Idempotent via the partial unique index identity_links_profile_anon_uq;
    // refreshes last_seen_at so the stitch carries recency. Raw SQL because
    // this drizzle version cannot express a partial-index conflict target.
    await db.execute(sql`
      insert into identity_links (profile_id, anonymous_id, link_type, link_confidence, last_seen_at)
      values (${profileId}, ${anonymousId}, 'PROFILE_OBSERVED', 60, now())
      on conflict (profile_id, anonymous_id) where link_type = 'PROFILE_OBSERVED'
      do update set last_seen_at = now(), updated_at = now()
    `);
  }
}
