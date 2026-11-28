CREATE TABLE "auto_fix_seen" (
	"chat_id" uuid NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_fix_seen_chat_id_key_pk" PRIMARY KEY("chat_id","key")
);
--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "auto_fix_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "auto_fix_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "auto_fix_note" text;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "auto_fix" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auto_fix_seen" ADD CONSTRAINT "auto_fix_seen_chat_id_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chat"("id") ON DELETE cascade ON UPDATE no action;