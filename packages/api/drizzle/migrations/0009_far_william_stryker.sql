CREATE TABLE "ai_admin_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"tool" text NOT NULL,
	"command" jsonb NOT NULL,
	"result_summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_admin_actions" ADD CONSTRAINT "ai_admin_actions_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;