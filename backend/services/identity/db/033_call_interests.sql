ALTER TABLE accounts
  ADD COLUMN call_interest_version integer NOT NULL DEFAULT 1 CHECK (call_interest_version > 0),
  ADD COLUMN voice_call_interest_at timestamptz,
  ADD COLUMN video_call_interest_at timestamptz;

-- Clear these optional preferences even when an older worker finishes a deletion.
CREATE FUNCTION clear_deleted_account_call_interests() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.voice_call_interest_at := NULL;
  NEW.video_call_interest_at := NULL;
  NEW.call_interest_version := 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER clear_deleted_account_call_interests
BEFORE UPDATE OF status ON accounts
FOR EACH ROW WHEN (NEW.status = 'deleted')
EXECUTE FUNCTION clear_deleted_account_call_interests();
