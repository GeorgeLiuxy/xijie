ALTER TABLE app_sessions ADD COLUMN reauthenticated_at timestamptz;
ALTER TABLE accounts ADD COLUMN deletion_requested_at timestamptz;
ALTER TABLE accounts ADD COLUMN deleted_at timestamptz;
ALTER TABLE accounts ADD CONSTRAINT accounts_deletion_times CHECK (
 (status NOT IN ('deletion_pending','deleted') OR deletion_requested_at IS NOT NULL)
 AND ((status='deleted')=(deleted_at IS NOT NULL))
 AND (deleted_at IS NULL OR deleted_at>=deletion_requested_at));
ALTER TABLE auth_attempts DROP CONSTRAINT auth_attempts_purpose_check;
ALTER TABLE auth_attempts ADD CONSTRAINT auth_attempts_purpose_check CHECK(purpose IN ('sign_in','switch','reauthenticate'));
DO $$ DECLARE constraint_name text; BEGIN
 FOR constraint_name IN SELECT conname FROM pg_constraint WHERE conrelid='auth_attempts'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%initiating_session_id%' AND pg_get_constraintdef(oid) LIKE '%purpose%'
 LOOP EXECUTE format('ALTER TABLE auth_attempts DROP CONSTRAINT %I',constraint_name); END LOOP;
END $$;
ALTER TABLE auth_attempts ADD CONSTRAINT auth_attempts_initiator_check CHECK((purpose IN ('switch','reauthenticate'))=(initiating_session_id IS NOT NULL));
ALTER TABLE auth_sms_challenges DROP CONSTRAINT auth_sms_challenges_purpose_check;
ALTER TABLE auth_sms_challenges ADD CONSTRAINT auth_sms_challenges_purpose_check CHECK(purpose IN ('sign_in','switch','reauthenticate'));

CREATE TABLE data_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL REFERENCES accounts(id),
 kind text NOT NULL CHECK(kind IN ('export','delete_account')),scope text NOT NULL CHECK(scope IN ('interaction_data','account_data')),
 idempotency_key uuid NOT NULL,request_hash text NOT NULL,
 status text NOT NULL DEFAULT 'accepted' CHECK(status IN ('accepted','processing','completed','failed')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 started_at timestamptz,finished_at timestamptz,result_expires_at timestamptz,
 dispatch_id uuid NOT NULL,dispatch_generation integer NOT NULL DEFAULT 1 CHECK(dispatch_generation>0),attempt_id uuid,attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),lease_until timestamptz,
 failure_code text,progress jsonb NOT NULL DEFAULT '{}',
 UNIQUE(account_id,idempotency_key),UNIQUE(account_id,id),
 CHECK(kind='export' OR scope='account_data'),
 CHECK((status='processing')=(attempt_id IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK((status IN ('completed','failed'))=(finished_at IS NOT NULL)),
 CHECK(started_at IS NULL OR started_at>=requested_at),CHECK(finished_at IS NULL OR finished_at>=requested_at)
);
CREATE UNIQUE INDEX one_account_deletion_request ON data_requests(account_id) WHERE kind='delete_account';
CREATE INDEX data_requests_recent ON data_requests(account_id,requested_at DESC,id DESC);
CREATE TABLE data_request_receipts(
 receipt_id uuid PRIMARY KEY,request_id uuid NOT NULL UNIQUE REFERENCES data_requests(id),proof_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '7 days',
 CHECK(expires_at>created_at));
CREATE TABLE data_rights_commands(
 account_id uuid NOT NULL REFERENCES accounts(id),operation text NOT NULL,target uuid NOT NULL,idempotency_key uuid NOT NULL,
 request_hash text NOT NULL,result_id uuid NOT NULL REFERENCES data_requests(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,operation,target,idempotency_key));
CREATE TABLE data_exports(
 request_id uuid PRIMARY KEY REFERENCES data_requests(id),ciphertext bytea NOT NULL,iv bytea NOT NULL,tag bytea NOT NULL,digest text NOT NULL,
 revisions jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,
 CHECK(octet_length(iv)=12 AND octet_length(tag)=16),CHECK(expires_at>created_at));
CREATE TABLE data_export_grants(
 id uuid PRIMARY KEY,request_id uuid NOT NULL REFERENCES data_requests(id),session_id uuid NOT NULL REFERENCES app_sessions(id),
 idempotency_key uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,
 UNIQUE(session_id,request_id,idempotency_key),CHECK(expires_at>created_at));
