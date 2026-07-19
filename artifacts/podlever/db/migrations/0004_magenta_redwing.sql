ALTER TABLE "waitlist" ADD COLUMN "replit_user_id" text;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_replit_user_id_unique" UNIQUE("replit_user_id");