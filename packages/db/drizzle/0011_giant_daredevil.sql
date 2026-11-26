ALTER TABLE "run" ADD COLUMN "verify" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "verification" jsonb;