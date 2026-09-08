ALTER TABLE "orders" ADD COLUMN "stripe_session_id" varchar(255);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_stripe_session_id_unique" UNIQUE("stripe_session_id");