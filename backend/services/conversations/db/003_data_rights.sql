CREATE TABLE account_erasure_fences (
  account_id uuid PRIMARY KEY,
  request_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  erased_at timestamptz,
  CHECK ((request_id IS NULL) = (erased_at IS NULL)),
  CHECK (erased_at IS NULL OR erased_at >= created_at)
);
CREATE FUNCTION enforce_account_erasure_fence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE erased timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.account_id <> OLD.account_id THEN
    RAISE EXCEPTION 'Account ownership is immutable' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('xijie:conversations:erasure:' || NEW.account_id::text, 0));
  INSERT INTO account_erasure_fences(account_id) VALUES(NEW.account_id) ON CONFLICT DO NOTHING;
  SELECT erased_at INTO erased FROM account_erasure_fences WHERE account_id=NEW.account_id FOR SHARE;
  IF erased IS NOT NULL THEN
    RAISE EXCEPTION 'Account data has been erased' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER conversations_erasure BEFORE INSERT OR UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
CREATE TRIGGER messages_erasure BEFORE INSERT OR UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
CREATE TRIGGER generation_jobs_erasure BEFORE INSERT OR UPDATE ON generation_jobs
  FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
CREATE TRIGGER conversation_commands_erasure BEFORE INSERT OR UPDATE ON conversation_commands
  FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
CREATE TRIGGER conversation_outbox_erasure BEFORE INSERT OR UPDATE ON outbox_events
  FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
