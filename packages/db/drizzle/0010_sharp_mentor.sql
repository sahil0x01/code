ALTER TABLE "run" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;