-- Slice 0B: repair four release-readiness columns whose FKs to users(id)
-- could never apply (varchar -> uuid, SQLSTATE 42804 on every fresh replay),
-- then add the constraints properly. Values are uuid strings written by the
-- app, so the USING casts are lossless. Guarded and idempotent.
ALTER TABLE "release_decisions" ALTER COLUMN "recorded_by" SET DATA TYPE uuid USING "recorded_by"::uuid;--> statement-breakpoint
ALTER TABLE "release_readiness_audit_log" ALTER COLUMN "admin_user_id" SET DATA TYPE uuid USING "admin_user_id"::uuid;--> statement-breakpoint
ALTER TABLE "release_readiness_gate_results" ALTER COLUMN "acknowledged_by" SET DATA TYPE uuid USING "acknowledged_by"::uuid;--> statement-breakpoint
ALTER TABLE "release_readiness_runs" ALTER COLUMN "triggered_by" SET DATA TYPE uuid USING "triggered_by"::uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "release_decisions" ADD CONSTRAINT "release_decisions_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "release_readiness_audit_log" ADD CONSTRAINT "release_readiness_audit_log_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "release_readiness_gate_results" ADD CONSTRAINT "release_readiness_gate_results_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "release_readiness_runs" ADD CONSTRAINT "release_readiness_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
