ALTER TABLE person_drafts ADD COLUMN conversation_tone text CHECK(conversation_tone IN ('gentle','witty','quiet','stern'));
ALTER TABLE person_drafts ADD COLUMN voice_timbre text CHECK(voice_timbre IN ('warm','bright','deep'));
ALTER TABLE persons ADD COLUMN conversation_tone text CHECK(conversation_tone IN ('gentle','witty','quiet','stern'));
ALTER TABLE persons ADD COLUMN voice_timbre text CHECK(voice_timbre IN ('warm','bright','deep'));
CREATE TABLE person_draft_voice_epochs(account_id uuid NOT NULL,draft_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),PRIMARY KEY(account_id,draft_id),UNIQUE(account_id,draft_id,version),FOREIGN KEY(account_id,draft_id) REFERENCES person_drafts(account_id,id));
CREATE TRIGGER person_voice_epoch_erasure BEFORE INSERT OR UPDATE ON person_draft_voice_epochs FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
CREATE TABLE person_draft_voice(
 account_id uuid NOT NULL,draft_id uuid NOT NULL,voice_id uuid NOT NULL,media_version integer NOT NULL CHECK(media_version>0),
 binding_version integer NOT NULL CHECK(binding_version>0),
 duration_ms integer NOT NULL CHECK(duration_ms BETWEEN 1 AND 30000),mime_type text NOT NULL CHECK(mime_type='audio/wav'),
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 46 AND 1440044 AND (byte_size-44)%2=0),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(account_id,draft_id),UNIQUE(account_id,voice_id),
 FOREIGN KEY(account_id,draft_id) REFERENCES person_drafts(account_id,id),
 FOREIGN KEY(account_id,draft_id,binding_version) REFERENCES person_draft_voice_epochs(account_id,draft_id,version) DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER person_voice_erasure BEFORE INSERT OR UPDATE ON person_draft_voice FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
CREATE FUNCTION guard_person_voice_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.draft_id<>OLD.draft_id OR NEW.version<>OLD.version+1) THEN RAISE EXCEPTION 'Voice binding epochs only advance.' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM account_erasure_fences WHERE account_id=OLD.account_id AND erased_at IS NOT NULL) THEN RAISE EXCEPTION 'Voice binding epochs persist until erasure.' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER person_voice_epoch_monotonic BEFORE UPDATE OR DELETE ON person_draft_voice_epochs FOR EACH ROW EXECUTE FUNCTION guard_person_voice_epoch();

-- A settings UPSERT runs BEFORE INSERT even when it will update an existing
-- opt-in. Keeping its already frozen time zone must still allow disabling it.
CREATE OR REPLACE FUNCTION validate_person_reminder_setting() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.time_zone IS NOT NULL AND NOT NEW.enabled AND ((TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM person_reminder_settings WHERE account_id=NEW.account_id AND person_id=NEW.person_id AND time_zone=NEW.time_zone)) OR (TG_OP='UPDATE' AND OLD.time_zone IS NULL)) THEN RAISE EXCEPTION 'Choose reminder time zone on first enable' USING ERRCODE='23514'; END IF;
 IF NEW.time_zone IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.time_zone AND (name='UTC' OR name LIKE '%/%') AND name NOT LIKE 'posix/%' AND name NOT LIKE 'right/%') THEN RAISE EXCEPTION 'Invalid reminder time zone' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.time_zone IS NOT NULL AND NEW.time_zone IS DISTINCT FROM OLD.time_zone THEN RAISE EXCEPTION 'Reminder time zone is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
