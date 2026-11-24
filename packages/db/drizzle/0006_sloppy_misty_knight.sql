CREATE TABLE "project_env_var" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_env_var_project_name_unique" UNIQUE("project_id","name")
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "install_command" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "test_command" text;--> statement-breakpoint
ALTER TABLE "project_env_var" ADD CONSTRAINT "project_env_var_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;