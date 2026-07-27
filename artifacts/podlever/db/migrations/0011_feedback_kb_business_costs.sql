ALTER TABLE "feedback" ADD COLUMN "status" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "resolution_link" text;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "business_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"category" text DEFAULT 'infrastructure' NOT NULL,
	"monthly_usd" numeric(10, 2) NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
