-- 0090: Compliance controls for the reward draw, and the draw PAUSED pending
-- a Ugandan legal read.
--
-- WHY THIS EXISTS. The draw was built on the common-law test that a lottery
-- needs prize + chance + CONSIDERATION, and the design removed consideration
-- (cards are granted for an already-delivered order, nobody pays to play).
-- Research into the actual statute shows that test is the WRONG ONE for
-- Uganda. The Lotteries and Gaming Act 2016 (Cap 334) defines:
--
--   "lottery"  = "any game, scheme or arrangement, system, plan, PROMOTIONAL
--                 COMPETITION or device for distributing prizes or property by
--                 lot or chance"
--   "promotional competition" = "a lottery, game or contest conducted for the
--                 purpose of promoting the sale or use of any goods or
--                 services"
--
-- There is no consideration element on the face of that definition, and
-- "promotional competition" describes this mechanic almost exactly. Section 64
-- makes conducting a lottery without a licence an offence, with penalties
-- reported up to 1,000 currency points and/or up to four years' imprisonment;
-- promoting an unlicensed lottery is a separate offence. The Act also defines
-- a "minor" as a person UNDER 25 — the highest gaming age in Africa — and
-- restricts minors' participation.
--
-- So the mechanic may require an LGRB licence. That is a question for Ugandan
-- counsel, not for this migration. See docs/loyalty-legal-brief.md.
--
-- WHAT THIS MIGRATION DOES:
--   1. Pauses the draw (chance_enabled = false) until the read is done.
--   2. Makes the compliance basis a STRUCTURAL precondition: draws cannot run
--      unless someone with admin rights has recorded either an LGRB licence or
--      a documented counsel opinion. "We forgot to check" stops being possible.
--   3. Sets a minimum age, defaulting to 25 to match the Act's definition of a
--      minor, enforced fail-closed (no recorded date of birth = not eligible).
--   4. Adds self-exclusion, so a customer can opt out of chance mechanics
--      permanently while keeping the rest of the loyalty programme.
--
-- Additive and reversible.
-- Rollback: DROP TABLE loyalty_draw_compliance; ALTER TABLE users DROP COLUMN
--   chance_self_excluded_at. (Comment only.)

-- 1. Pause. Nothing had been issued: 0 cards, 0 prizes.
UPDATE "loyalty_config" SET "chance_enabled" = false, "updated_at" = now() WHERE "singleton" = 'config';
--> statement-breakpoint

-- 2. The compliance basis on which draws may run.
CREATE TABLE IF NOT EXISTS "loyalty_draw_compliance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- 'none'                   → draws cannot run (the default, and the state
  --                            the system is in until Rob records otherwise)
  -- 'licensed'               → an LGRB licence is held; reference + expiry required
  -- 'counsel_advised_exempt' → Ugandan counsel has advised in writing that the
  --                            mechanic falls outside the licensing regime;
  --                            the opinion reference is required
  "basis" varchar(30) DEFAULT 'none' NOT NULL,
  "licence_reference" varchar(120),
  "licence_issuer" varchar(160),
  "licence_expires_at" date,
  "counsel_reference" varchar(300),
  "counsel_opinion_date" date,
  /** Minimum age to receive or play a card. 25 = the Act's "minor" threshold. */
  "min_age" integer DEFAULT 25 NOT NULL,
  "jurisdiction" varchar(8) DEFAULT 'UG' NOT NULL,
  "acknowledged_by" uuid,
  "acknowledged_at" timestamp with time zone,
  "notes" varchar(1000),
  "singleton" varchar(12) DEFAULT 'compliance' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "loyalty_draw_compliance_basis_check"
    CHECK ("basis" in ('none', 'licensed', 'counsel_advised_exempt')),
  -- A licence basis is meaningless without a reference and an expiry to check.
  CONSTRAINT "loyalty_draw_compliance_licensed_check"
    CHECK ("basis" <> 'licensed' OR ("licence_reference" IS NOT NULL AND "licence_expires_at" IS NOT NULL)),
  -- An exemption basis is meaningless without a traceable written opinion.
  CONSTRAINT "loyalty_draw_compliance_counsel_check"
    CHECK ("basis" <> 'counsel_advised_exempt' OR ("counsel_reference" IS NOT NULL AND "counsel_opinion_date" IS NOT NULL)),
  -- Any basis other than 'none' must name the person who accepted it.
  CONSTRAINT "loyalty_draw_compliance_ack_check"
    CHECK ("basis" = 'none' OR ("acknowledged_by" IS NOT NULL AND "acknowledged_at" IS NOT NULL)),
  CONSTRAINT "loyalty_draw_compliance_age_check" CHECK ("min_age" BETWEEN 18 AND 30)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_draw_compliance_singleton_uq" ON "loyalty_draw_compliance" ("singleton");
--> statement-breakpoint

-- Seed the honest state: no basis recorded, so draws cannot run.
INSERT INTO "loyalty_draw_compliance" ("basis", "min_age", "jurisdiction", "notes")
VALUES ('none', 25, 'UG',
  'Seeded 2026-08-05. Draws are paused pending a Ugandan legal read: the Lotteries and Gaming Act 2016 defines "lottery" to include a "promotional competition" without an apparent consideration element, so removing consideration may not take this mechanic outside the licensing regime. See docs/loyalty-legal-brief.md.')
ON CONFLICT ("singleton") DO NOTHING;
--> statement-breakpoint

-- 3. Self-exclusion: a customer can opt out of chance mechanics permanently
-- while keeping every other part of the loyalty programme.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "chance_self_excluded_at" timestamp with time zone;
