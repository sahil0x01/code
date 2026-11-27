ALTER TABLE "run" DROP CONSTRAINT "run_stop_reason_check";--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "model_cost" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "sandbox_cost" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_step" ADD COLUMN "cost" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_stop_reason_check" CHECK ("run"."stop_reason" is null or "run"."stop_reason" in ('completed', 'step-limit', 'token-budget', 'cost-limit', 'timeout', 'aborted', 'error'));