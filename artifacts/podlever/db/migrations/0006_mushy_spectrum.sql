CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"session_id" text,
	"event_name" text NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "utm_source" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "utm_medium" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "utm_campaign" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "utm_content" text;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;