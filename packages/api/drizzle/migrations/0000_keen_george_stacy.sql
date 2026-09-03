CREATE TYPE "public"."seat_status" AS ENUM('available', 'reserved', 'sold', 'blocked');--> statement-breakpoint
CREATE TABLE "seats" (
	"id" text PRIMARY KEY NOT NULL,
	"performance_id" text NOT NULL,
	"row" text NOT NULL,
	"number" integer NOT NULL,
	"zone" text NOT NULL,
	"price" integer NOT NULL,
	"status" "seat_status" DEFAULT 'available' NOT NULL,
	"reserved_by" text,
	"reserved_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seats_reservation_pair_check" CHECK (("seats"."reserved_by" IS NULL AND "seats"."reserved_until" IS NULL) OR ("seats"."reserved_by" IS NOT NULL AND "seats"."reserved_until" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "seats_performance_id_idx" ON "seats" USING btree ("performance_id");--> statement-breakpoint
CREATE INDEX "seats_status_idx" ON "seats" USING btree ("status");--> statement-breakpoint
CREATE INDEX "seats_reserved_until_idx" ON "seats" USING btree ("reserved_until");