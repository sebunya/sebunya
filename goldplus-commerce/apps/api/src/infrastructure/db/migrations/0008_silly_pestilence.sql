CREATE INDEX IF NOT EXISTS "order_items_product_order_idx" ON "order_items" ("product_id","order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_order_product_idx" ON "order_items" ("order_id","product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_user_created_idx" ON "orders" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_payment_created_idx" ON "orders" ("payment_status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_events_cooccurrence_idx" ON "activity_events" ("entity","event_type","entity_id","visitor_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_events_user_recent_idx" ON "activity_events" ("user_id","entity","event_type","created_at");