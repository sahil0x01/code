CREATE TABLE "preview" (
	"chat_id" uuid PRIMARY KEY NOT NULL,
	"generation" uuid NOT NULL,
	"status" text NOT NULL,
	"url" text,
	"error" text,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "preview" ADD CONSTRAINT "preview_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;