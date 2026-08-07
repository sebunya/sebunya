import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Applies migrations 0099–0103 idempotently for suites that need the R1/R2
 * columns on top of the production-schema snapshot (which predates them).
 * Serialized under a Postgres advisory lock: CREATE INDEX IF NOT EXISTS is
 * NOT concurrency-safe (two racing creators still collide in pg_class), and
 * vitest runs suites in parallel workers.
 */
const MIGRATIONS = ["0099_recommendation_event_contract.sql", "0100_experience_profiles.sql", "0101_order_profile_stitching.sql", "0102_commercial_costs.sql", "0103_refund_ledger.sql", "0104_product_cost_entries.sql", "0105_commercial_indexes.sql", "0106_account_recovery_and_social_identity.sql", "0107_hero_slides.sql"];
const ADVISORY_LOCK_KEY = 209_920_260_806;

type Pg = {
  unsafe(query: string): Promise<unknown>;
};

export async function applyRecommendationMigrations(pg: Pg): Promise<void> {
  await pg.unsafe(`select pg_advisory_lock(${ADVISORY_LOCK_KEY})`);
  try {
    for (const file of MIGRATIONS) {
      const text = readFileSync(
        join(__dirname, "../../../apps/api/src/infrastructure/db/migrations", file),
        "utf8",
      );
      for (const statement of text.split("--> statement-breakpoint")) {
        const trimmed = statement.replace(/^--.*$/gm, "").trim();
        if (trimmed) await pg.unsafe(trimmed);
      }
    }
  } finally {
    await pg.unsafe(`select pg_advisory_unlock(${ADVISORY_LOCK_KEY})`);
  }
}
