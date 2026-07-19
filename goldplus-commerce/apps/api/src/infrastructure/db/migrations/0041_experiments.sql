CREATE TABLE IF NOT EXISTS "experiments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "key" varchar(80) NOT NULL, "name" varchar(160) NOT NULL,
  "hypothesis" text NOT NULL, "primary_metric" varchar(120) NOT NULL, "status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL, "created_by" uuid, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "experiment_variants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "experiment_id" uuid NOT NULL, "key" varchar(40) NOT NULL,
  "name" varchar(120) NOT NULL, "weight_basis_points" integer NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "experiment_variant_weight_check" CHECK ("weight_basis_points" > 0 AND "weight_basis_points" < 10000)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "experiment_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "experiment_id" uuid NOT NULL, "subject_hash" varchar(64) NOT NULL,
  "variant_key" varchar(40) NOT NULL, "assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "experiment_exposures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "assignment_id" uuid NOT NULL, "experiment_id" uuid NOT NULL,
  "exposure_key" varchar(160) NOT NULL, "occurred_at" timestamp with time zone NOT NULL, "recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "experiments_key_idx" ON "experiments" ("key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "experiments_status_idx" ON "experiments" ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "experiment_variants_experiment_key_idx" ON "experiment_variants" ("experiment_id", "key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "experiment_assignments_subject_idx" ON "experiment_assignments" ("experiment_id", "subject_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "experiment_assignments_variant_idx" ON "experiment_assignments" ("experiment_id", "variant_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "experiment_exposures_key_idx" ON "experiment_exposures" ("experiment_id", "exposure_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "experiment_exposures_experiment_idx" ON "experiment_exposures" ("experiment_id", "occurred_at");
--> statement-breakpoint
ALTER TABLE "experiment_variants" ADD CONSTRAINT "experiment_variants_experiment_fk" FOREIGN KEY ("experiment_id") REFERENCES "experiments"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_experiment_fk" FOREIGN KEY ("experiment_id") REFERENCES "experiments"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "experiment_exposures" ADD CONSTRAINT "experiment_exposures_assignment_fk" FOREIGN KEY ("assignment_id") REFERENCES "experiment_assignments"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "experiment_exposures" ADD CONSTRAINT "experiment_exposures_experiment_fk" FOREIGN KEY ("experiment_id") REFERENCES "experiments"("id") ON DELETE no action ON UPDATE no action;
