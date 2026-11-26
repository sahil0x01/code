CREATE TABLE "recording_deletion" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE FUNCTION queue_recording_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD.recording->>'status' = 'recorded'
		AND (TG_OP = 'DELETE' OR NEW.recording->>'key' IS DISTINCT FROM OLD.recording->>'key') THEN
		INSERT INTO recording_deletion (key) VALUES (OLD.recording->>'key') ON CONFLICT DO NOTHING;
	END IF;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER run_recording_removed
	AFTER DELETE OR UPDATE OF recording ON "run"
	FOR EACH ROW EXECUTE FUNCTION queue_recording_deletion();
