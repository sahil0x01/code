ALTER TABLE "chat" ADD COLUMN "seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "done_at" timestamp with time zone;--> statement-breakpoint
-- Chats that already exist are not new to their owner.
UPDATE "chat" SET "seen_at" = now();
