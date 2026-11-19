-- Journey captures have their own purpose and immutable delivery target.
ALTER TABLE media_objects DROP CONSTRAINT media_objects_purpose_check;
ALTER TABLE media_objects ADD COLUMN gift_delivery_id uuid;
ALTER TABLE media_objects ALTER COLUMN storage_authorization_version DROP NOT NULL;
ALTER TABLE media_objects ADD COLUMN gift_storage_authorization_version integer CHECK(gift_storage_authorization_version>0);
ALTER TABLE media_objects ADD CONSTRAINT media_objects_purpose_check CHECK(
 (purpose='post_attachment' AND client_post_id IS NOT NULL AND person_draft_id IS NULL AND gift_delivery_id IS NULL) OR
 (purpose='person_photo' AND person_draft_id IS NOT NULL AND client_post_id IS NULL AND gift_delivery_id IS NULL) OR
 (purpose='gift_delivery_photo' AND gift_delivery_id IS NOT NULL AND client_post_id IS NULL AND person_draft_id IS NULL));
ALTER TABLE media_objects ADD CONSTRAINT media_objects_storage_scope CHECK(
 (purpose='gift_delivery_photo' AND gift_storage_authorization_version IS NOT NULL AND storage_authorization_version IS NULL) OR
 (purpose IN('post_attachment','person_photo') AND storage_authorization_version IS NOT NULL AND gift_storage_authorization_version IS NULL));
ALTER TABLE media_objects ADD CONSTRAINT media_objects_gift_target UNIQUE(account_id,id,gift_delivery_id);
CREATE TABLE media_gift_grants(
 account_id uuid NOT NULL,media_id uuid NOT NULL,delivery_id uuid NOT NULL,photo_version integer NOT NULL CHECK(photo_version>1),
 media_version integer NOT NULL CHECK(media_version>0),state text NOT NULL DEFAULT 'active' CHECK(state IN('active','revoked')),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),last_bound_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 confirmed_at timestamptz(3),revoked_at timestamptz(3),PRIMARY KEY(account_id,media_id,photo_version),
 FOREIGN KEY(account_id,media_id,delivery_id) REFERENCES media_objects(account_id,id,gift_delivery_id),
 CHECK((state='revoked')=(revoked_at IS NOT NULL)),CHECK(created_at<=last_bound_at));
CREATE INDEX media_gift_grants_delivery ON media_gift_grants(account_id,delivery_id,photo_version);
CREATE TRIGGER media_gift_grants_gate BEFORE INSERT OR UPDATE ON media_gift_grants FOR EACH ROW EXECUTE FUNCTION media_person_grant_gate();
