-- Person photos have an independent purpose, target, consent and source authority.
ALTER TABLE media_objects DROP CONSTRAINT media_objects_purpose_check;
ALTER TABLE media_objects ALTER COLUMN client_post_id DROP NOT NULL;
ALTER TABLE media_objects ADD COLUMN person_draft_id uuid;
ALTER TABLE media_objects ADD CONSTRAINT media_objects_purpose_check CHECK(
 (purpose='post_attachment' AND client_post_id IS NOT NULL AND person_draft_id IS NULL) OR
 (purpose='person_photo' AND person_draft_id IS NOT NULL AND client_post_id IS NULL));
ALTER TABLE media_objects ADD CONSTRAINT media_objects_person_target UNIQUE(account_id,id,person_draft_id);
CREATE TABLE media_person_grants(
 account_id uuid NOT NULL,media_id uuid NOT NULL,draft_id uuid NOT NULL,media_version integer NOT NULL CHECK(media_version>0),
 state text NOT NULL DEFAULT 'active' CHECK(state IN('active','revoked')),created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 last_bound_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),confirmed_at timestamptz(3),revoked_at timestamptz(3),
 PRIMARY KEY(account_id,media_id),FOREIGN KEY(account_id,media_id,draft_id) REFERENCES media_objects(account_id,id,person_draft_id),
 CHECK((state='revoked')=(revoked_at IS NOT NULL)),CHECK(created_at<=last_bound_at));
CREATE INDEX media_person_grants_draft ON media_person_grants(account_id,draft_id);
CREATE FUNCTION media_person_grant_gate() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE fenced timestamptz;BEGIN
 IF TG_OP='UPDATE' AND NEW.account_id<>OLD.account_id THEN RAISE EXCEPTION 'immutable media account' USING ERRCODE='42501';END IF;
 SELECT erased_at INTO fenced FROM media_account_write_gates WHERE account_id=NEW.account_id FOR SHARE;
 IF NOT FOUND OR(fenced IS NOT NULL AND NEW.state='active') THEN RAISE EXCEPTION 'media account unavailable' USING ERRCODE='42501';END IF;RETURN NEW;END$$;
CREATE TRIGGER media_person_grants_gate BEFORE INSERT OR UPDATE ON media_person_grants FOR EACH ROW EXECUTE FUNCTION media_person_grant_gate();
