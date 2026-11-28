ALTER TABLE "chat" ADD COLUMN "merge_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "merge_sha" text;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "merge_updated_from" text;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "merge_fixes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "merge_run_id" uuid;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "merge_fix_head" text;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "merge_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "merge_note" text;