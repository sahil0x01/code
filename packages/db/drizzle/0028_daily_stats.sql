CREATE TABLE "daily_stats" (
	"day" date PRIMARY KEY NOT NULL,
	"users_joined" integer DEFAULT 0 NOT NULL,
	"active_users" integer DEFAULT 0 NOT NULL,
	"projects_connected" integer DEFAULT 0 NOT NULL,
	"chats_started" integer DEFAULT 0 NOT NULL,
	"runs_started" integer DEFAULT 0 NOT NULL,
	"runs_succeeded" integer DEFAULT 0 NOT NULL,
	"runs_failed" integer DEFAULT 0 NOT NULL,
	"runs_cancelled" integer DEFAULT 0 NOT NULL,
	"agent_seconds" bigint DEFAULT 0 NOT NULL,
	"steps" integer DEFAULT 0 NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"file_edits" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cached_input_tokens" bigint DEFAULT 0 NOT NULL,
	"model_cost" bigint DEFAULT 0 NOT NULL,
	"sandbox_cost" bigint DEFAULT 0 NOT NULL,
	"runs_verified" integer DEFAULT 0 NOT NULL,
	"runs_verified_passed" integer DEFAULT 0 NOT NULL,
	"pull_requests_opened" integer DEFAULT 0 NOT NULL,
	"pull_requests_merged" integer DEFAULT 0 NOT NULL,
	"lines_added" bigint DEFAULT 0 NOT NULL,
	"lines_removed" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "pull_request_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "pull_request_merged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "pull_request_additions" integer;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "pull_request_deletions" integer;--> statement-breakpoint
-- PRs opened before this kept no time; the chat's first finished run is the closest one.
UPDATE "chat" SET "pull_request_opened_at" = COALESCE(
	(SELECT min("finished_at") FROM "run" WHERE "run"."chat_id" = "chat"."id"),
	"chat"."created_at"
) WHERE "pull_request_number" IS NOT NULL;
