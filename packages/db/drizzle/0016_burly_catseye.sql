ALTER TABLE "run" ADD COLUMN "reasoning" text DEFAULT 'high' NOT NULL;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "cached_input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "reasoning_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_step" ADD COLUMN "reasoning" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "run_step" ADD COLUMN "cached_input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_step" ADD COLUMN "reasoning_tokens" integer DEFAULT 0 NOT NULL;