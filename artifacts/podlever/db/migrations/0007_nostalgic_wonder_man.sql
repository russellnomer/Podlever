ALTER TABLE "users" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "payment_grace_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_stripe_customer_id_unique" UNIQUE("stripe_customer_id");