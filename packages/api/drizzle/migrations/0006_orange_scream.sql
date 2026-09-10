CREATE TYPE "public"."performance_status" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
ALTER TABLE "performances" ADD COLUMN "status" "performance_status" DEFAULT 'scheduled' NOT NULL;