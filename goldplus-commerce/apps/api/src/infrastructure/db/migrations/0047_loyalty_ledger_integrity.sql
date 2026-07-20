CREATE INDEX IF NOT EXISTS "loyalty_ledger_order_idx"
  ON "loyalty_ledger_entries" ("order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_ledger_reversal_source_idx"
  ON "loyalty_ledger_entries" ("reversed_entry_id")
  WHERE "type" = 'reversal';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_ledger_expiry_source_idx"
  ON "loyalty_ledger_entries" ("reversed_entry_id")
  WHERE "type" = 'expiry';
--> statement-breakpoint
ALTER TABLE "loyalty_ledger_entries"
  ADD CONSTRAINT "loyalty_ledger_type_check"
  CHECK ("type" IN ('earn', 'redeem', 'reversal', 'expiry', 'adjustment'));
--> statement-breakpoint
ALTER TABLE "loyalty_ledger_entries"
  ADD CONSTRAINT "loyalty_ledger_shape_check"
  CHECK (
    "points" <> 0 AND (
      ("type" = 'earn' AND "points" > 0 AND "order_id" IS NOT NULL AND "reversed_entry_id" IS NULL)
      OR ("type" = 'redeem' AND "points" < 0 AND "reversed_entry_id" IS NULL)
      OR ("type" = 'expiry' AND "points" < 0 AND "reversed_entry_id" IS NOT NULL)
      OR ("type" = 'reversal' AND "reversed_entry_id" IS NOT NULL)
      OR ("type" = 'adjustment' AND "reversed_entry_id" IS NULL)
    )
  );
--> statement-breakpoint
ALTER TABLE "loyalty_ledger_entries"
  ADD CONSTRAINT "loyalty_ledger_related_entry_fk"
  FOREIGN KEY ("reversed_entry_id") REFERENCES "loyalty_ledger_entries"("id") ON DELETE RESTRICT;
