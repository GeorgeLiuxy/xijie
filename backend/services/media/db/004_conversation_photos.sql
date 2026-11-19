ALTER TABLE media_objects DROP CONSTRAINT media_objects_purpose_check;
ALTER TABLE media_objects DROP CONSTRAINT media_objects_storage_scope;
ALTER TABLE media_objects ADD COLUMN chat_conversation_id uuid,ADD COLUMN chat_client_message_id uuid;
ALTER TABLE media_objects ADD CONSTRAINT media_objects_purpose_check CHECK(COALESCE(
 (purpose='post_attachment' AND client_post_id IS NOT NULL AND person_draft_id IS NULL AND gift_delivery_id IS NULL AND chat_conversation_id IS NULL AND chat_client_message_id IS NULL) OR
 (purpose='person_photo' AND person_draft_id IS NOT NULL AND client_post_id IS NULL AND gift_delivery_id IS NULL AND chat_conversation_id IS NULL AND chat_client_message_id IS NULL) OR
 (purpose='gift_delivery_photo' AND gift_delivery_id IS NOT NULL AND client_post_id IS NULL AND person_draft_id IS NULL AND chat_conversation_id IS NULL AND chat_client_message_id IS NULL) OR
 (purpose='conversation_attachment' AND chat_conversation_id IS NOT NULL AND chat_client_message_id IS NOT NULL AND client_post_id IS NULL AND person_draft_id IS NULL AND gift_delivery_id IS NULL),false));
ALTER TABLE media_objects ADD CONSTRAINT media_objects_storage_scope CHECK(
 (purpose='gift_delivery_photo' AND gift_storage_authorization_version IS NOT NULL AND storage_authorization_version IS NULL) OR
 (purpose IN('post_attachment','person_photo','conversation_attachment') AND storage_authorization_version IS NOT NULL AND gift_storage_authorization_version IS NULL));
ALTER TABLE media_objects ADD UNIQUE(account_id,id,chat_conversation_id,chat_client_message_id);
CREATE TABLE media_conversation_grants(
 account_id uuid NOT NULL,media_id uuid NOT NULL,conversation_id uuid NOT NULL,client_message_id uuid NOT NULL,
 message_version integer NOT NULL DEFAULT 1 CHECK(message_version=1),media_version integer NOT NULL CHECK(media_version>0),
 state text NOT NULL DEFAULT 'active' CHECK(state IN('active','revoked')),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),last_bound_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),confirmed_at timestamptz(3),revoked_at timestamptz(3),
 PRIMARY KEY(account_id,media_id),UNIQUE(account_id,conversation_id,client_message_id),
 FOREIGN KEY(account_id,media_id,conversation_id,client_message_id) REFERENCES media_objects(account_id,id,chat_conversation_id,chat_client_message_id),
 CHECK((state='revoked')=(revoked_at IS NOT NULL)),CHECK(created_at<=last_bound_at));
CREATE FUNCTION protect_conversation_media_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='media_objects' THEN
  IF ROW(NEW.account_id,NEW.id,NEW.purpose,NEW.chat_conversation_id,NEW.chat_client_message_id) IS DISTINCT FROM ROW(OLD.account_id,OLD.id,OLD.purpose,OLD.chat_conversation_id,OLD.chat_client_message_id) AND (NEW.purpose='conversation_attachment' OR OLD.purpose='conversation_attachment') THEN RAISE EXCEPTION 'Conversation media target is immutable'; END IF;
 ELSE
  IF ROW(NEW.account_id,NEW.media_id,NEW.conversation_id,NEW.client_message_id,NEW.message_version,NEW.media_version,NEW.created_at) IS DISTINCT FROM ROW(OLD.account_id,OLD.media_id,OLD.conversation_id,OLD.client_message_id,OLD.message_version,OLD.media_version,OLD.created_at) OR(OLD.state='revoked' AND NEW.state<>'revoked') THEN RAISE EXCEPTION 'Conversation media binding is immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER conversation_media_target_immutable BEFORE UPDATE ON media_objects FOR EACH ROW EXECUTE FUNCTION protect_conversation_media_target();
CREATE TRIGGER conversation_media_grant_immutable BEFORE UPDATE ON media_conversation_grants FOR EACH ROW EXECUTE FUNCTION protect_conversation_media_target();
