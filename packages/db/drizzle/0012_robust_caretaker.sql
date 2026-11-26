ALTER TABLE "chat" ADD COLUMN "pull_request_number" integer;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "pull_request_url" text;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "pull_request_error" text;