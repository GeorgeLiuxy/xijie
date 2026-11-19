-- This gate is also taken by ordinary writes, before they acquire any domain
-- parent locks. An upsert, rather than a snapshot-only lookup, makes stale
-- repeatable-read writers fail serialization after erasure as well.
CREATE TABLE memory_account_write_gates (
 account_id uuid PRIMARY KEY,
 created_at timestamptz(3) NOT NULL DEFAULT statement_timestamp(),
 erased_at timestamptz(3), request_id uuid,
 CHECK ((erased_at IS NULL) = (request_id IS NULL)),
 CHECK (erased_at IS NULL OR created_at <= erased_at)
);
CREATE TABLE memory_erasure_receipts (
 account_id uuid PRIMARY KEY REFERENCES memory_account_write_gates(account_id),
 request_id uuid NOT NULL UNIQUE,
 erased_at timestamptz(3) NOT NULL
);

CREATE FUNCTION memory_guard_account_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE erased timestamptz;
BEGIN
 IF TG_OP = 'UPDATE' AND NEW.account_id IS DISTINCT FROM OLD.account_id THEN
  RAISE EXCEPTION 'Account ownership cannot change.' USING ERRCODE = '23514';
 END IF;
 INSERT INTO memory_account_write_gates(account_id) VALUES (NEW.account_id)
 ON CONFLICT(account_id) DO UPDATE SET account_id = EXCLUDED.account_id
 RETURNING erased_at INTO erased;
 IF erased IS NOT NULL THEN
  RAISE EXCEPTION 'Account data has been erased.' USING ERRCODE = '42501';
 END IF;
 RETURN NEW;
END;
$$;

CREATE TRIGGER memory_cursor_account_gate BEFORE INSERT OR UPDATE ON memory_account_cursors
 FOR EACH ROW EXECUTE FUNCTION memory_guard_account_write();
CREATE TRIGGER memory_original_account_gate BEFORE INSERT OR UPDATE ON memories
 FOR EACH ROW EXECUTE FUNCTION memory_guard_account_write();
CREATE TRIGGER memory_command_account_gate BEFORE INSERT OR UPDATE ON memory_commands
 FOR EACH ROW EXECUTE FUNCTION memory_guard_account_write();
CREATE TRIGGER memory_outbox_account_gate BEFORE INSERT OR UPDATE ON outbox_events
 FOR EACH ROW EXECUTE FUNCTION memory_guard_account_write();
CREATE TRIGGER memory_job_account_gate BEFORE INSERT OR UPDATE ON memory_generation_jobs
 FOR EACH ROW EXECUTE FUNCTION memory_guard_account_write();
CREATE TRIGGER memory_candidate_account_gate BEFORE INSERT OR UPDATE ON memory_candidates
 FOR EACH ROW EXECUTE FUNCTION memory_guard_account_write();
CREATE TRIGGER memory_candidate_command_account_gate BEFORE INSERT OR UPDATE ON candidate_commands
 FOR EACH ROW EXECUTE FUNCTION memory_guard_account_write();
