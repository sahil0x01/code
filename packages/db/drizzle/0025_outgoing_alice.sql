CREATE TABLE "user_model" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"label" text NOT NULL,
	"base_url" text,
	"key_encrypted" text NOT NULL,
	"key_last4" text NOT NULL,
	"context_tokens" integer,
	"max_output_tokens" integer,
	"price" jsonb,
	"max_run_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_model_user_label_unique" UNIQUE("user_id","label")
);
--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "model_label" text;--> statement-breakpoint
ALTER TABLE "user_model" ADD CONSTRAINT "user_model_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_model_user_idx" ON "user_model" USING btree ("user_id");