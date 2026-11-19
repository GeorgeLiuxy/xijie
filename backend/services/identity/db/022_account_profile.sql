CREATE TABLE account_profile_commands(
 account_id uuid NOT NULL REFERENCES accounts(id),idempotency_key uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),accepted_version integer NOT NULL CHECK(accepted_version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(account_id,idempotency_key)
);
CREATE FUNCTION guard_account_profile_command() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Account profile receipts are immutable' USING ERRCODE='42501';END IF;
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM accounts WHERE id=OLD.account_id AND status IN('deletion_pending','deleted')) THEN RETURN OLD;END IF;
  RAISE EXCEPTION 'Profile receipts require account erasure' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.account_id AND status='active' AND version=NEW.accepted_version) THEN RAISE EXCEPTION 'Profile account is unavailable' USING ERRCODE='42501';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER account_profile_command_guard BEFORE INSERT OR UPDATE OR DELETE ON account_profile_commands FOR EACH ROW EXECUTE FUNCTION guard_account_profile_command();
