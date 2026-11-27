CREATE TABLE "connector_link_code" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connection" ALTER COLUMN "token_encrypted" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "connector_request" ADD COLUMN "target" text;--> statement-breakpoint
ALTER TABLE "connector_link_code" ADD CONSTRAINT "connector_link_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;