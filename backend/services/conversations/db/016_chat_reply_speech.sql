CREATE TABLE chat_reply_speech (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  source_version integer NOT NULL CHECK(source_version>0),
  account_access_version integer NOT NULL CHECK(account_access_version>0),
  storage_version integer NOT NULL CHECK(storage_version>0),
  speech_version integer NOT NULL CHECK(speech_version>0),
  production_version integer NOT NULL CHECK(production_version>=0),
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','ready','failed','blocked')),
  attempt_id uuid UNIQUE,
  lease_until timestamptz,
  wav bytea CHECK(octet_length(wav) BETWEEN 46 AND 2160044),
  model text CHECK(char_length(model) BETWEEN 1 AND 100),
  recovery_blocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(account_id,message_id,source_version,account_access_version,storage_version,speech_version,production_version),
  FOREIGN KEY(account_id,conversation_id,message_id) REFERENCES messages(account_id,conversation_id,id) ON DELETE CASCADE,
  CHECK((state='running')=(lease_until IS NOT NULL)),
  CHECK(state IN ('failed','blocked') OR (state='queued')=(attempt_id IS NULL)),
  CHECK((state='ready')=(wav IS NOT NULL)),
  CHECK((state='ready')=(model IS NOT NULL))
);
CREATE INDEX chat_reply_speech_worker ON chat_reply_speech(state,created_at,id) WHERE state IN ('queued','running');
CREATE TRIGGER chat_reply_speech_erasure BEFORE INSERT OR UPDATE ON chat_reply_speech
  FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();

-- Removed or restricted source text instantly loses its cached audio.
CREATE FUNCTION clear_changed_reply_speech() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.removed_at IS NOT NULL OR NEW.version <> OLD.version THEN
    DELETE FROM chat_reply_speech s WHERE s.account_id=OLD.account_id AND s.conversation_id=OLD.conversation_id
      AND (s.message_id=OLD.id OR EXISTS(SELECT 1 FROM messages m
        WHERE m.account_id=s.account_id AND m.conversation_id=s.conversation_id AND m.id=s.message_id AND m.reply_to_message_id=OLD.id));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER clear_changed_reply_speech AFTER UPDATE OF removed_at,version ON messages
  FOR EACH ROW EXECUTE FUNCTION clear_changed_reply_speech();
