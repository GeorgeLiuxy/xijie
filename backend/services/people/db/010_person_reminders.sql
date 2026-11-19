-- The opt-in and its next due check survive server restarts. No default grant.
CREATE TABLE person_reminder_settings (
 account_id uuid NOT NULL, person_id uuid NOT NULL,
 enabled boolean NOT NULL DEFAULT false, time_zone text,
 authorization_version integer CHECK(authorization_version>0),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 next_check_at timestamptz, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,person_id),
 FOREIGN KEY(account_id,person_id) REFERENCES persons(account_id,id),
 CHECK(NOT enabled OR (time_zone IS NOT NULL AND authorization_version IS NOT NULL AND next_check_at IS NOT NULL)),
 CHECK(time_zone IS NULL OR char_length(time_zone) BETWEEN 1 AND 100)
);
CREATE INDEX person_reminders_due ON person_reminder_settings(next_check_at) WHERE enabled;
CREATE TABLE person_reminder_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL, person_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('birthday','meeting_anniversary')),
 local_date date NOT NULL, local_year integer NOT NULL CHECK(local_year BETWEEN 1 AND 9999),
 authorization_version integer NOT NULL CHECK(authorization_version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), read_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 FOREIGN KEY(account_id,person_id) REFERENCES persons(account_id,id),
 UNIQUE(account_id,person_id,kind,local_year),
 CHECK(EXTRACT(YEAR FROM local_date)=local_year), CHECK(read_at IS NULL OR read_at>=created_at)
);
CREATE INDEX person_reminder_notices_order ON person_reminder_notifications(account_id,created_at DESC,id DESC);
CREATE TABLE person_reminder_commands (
 account_id uuid NOT NULL, idempotency_key uuid NOT NULL, request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(account_id,idempotency_key)
);
CREATE TRIGGER person_reminder_settings_erasure BEFORE INSERT OR UPDATE ON person_reminder_settings FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
CREATE TRIGGER person_reminder_notifications_erasure BEFORE INSERT OR UPDATE ON person_reminder_notifications FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
CREATE TRIGGER person_reminder_commands_erasure BEFORE INSERT OR UPDATE ON person_reminder_commands FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();

CREATE FUNCTION validate_person_reminder_setting() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.time_zone IS NOT NULL AND NOT NEW.enabled AND (TG_OP='INSERT' OR OLD.time_zone IS NULL) THEN RAISE EXCEPTION 'Choose reminder time zone on first enable' USING ERRCODE='23514'; END IF;
 IF NEW.time_zone IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.time_zone AND (name='UTC' OR name LIKE '%/%') AND name NOT LIKE 'posix/%' AND name NOT LIKE 'right/%') THEN RAISE EXCEPTION 'Invalid reminder time zone' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.time_zone IS NOT NULL AND NEW.time_zone IS DISTINCT FROM OLD.time_zone THEN RAISE EXCEPTION 'Reminder time zone is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER person_reminder_setting_valid BEFORE INSERT OR UPDATE ON person_reminder_settings FOR EACH ROW EXECUTE FUNCTION validate_person_reminder_setting();
