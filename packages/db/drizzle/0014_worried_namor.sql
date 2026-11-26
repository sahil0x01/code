ALTER TABLE "run" ADD COLUMN "record" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "recording" jsonb;