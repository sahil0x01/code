ALTER TABLE "run" ADD COLUMN "changed_files" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "stop_requested_at" timestamp with time zone;