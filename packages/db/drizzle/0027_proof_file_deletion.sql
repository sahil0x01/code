-- A proof has a video and screenshots, and every file it stops pointing at is queued.
CREATE OR REPLACE FUNCTION queue_recording_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD.recording->>'status' = 'recorded'
		AND (TG_OP = 'DELETE' OR NEW.recording->>'key' IS DISTINCT FROM OLD.recording->>'key') THEN
		INSERT INTO recording_deletion (key)
		SELECT OLD.recording->>'key'
		UNION
		SELECT shot->>'key' FROM jsonb_array_elements(COALESCE(OLD.recording->'screenshots', '[]'::jsonb)) AS shot
		ON CONFLICT DO NOTHING;
	END IF;
	RETURN NULL;
END;
$$;
