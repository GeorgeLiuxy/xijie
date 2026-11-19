-- Automatically derived memories are separate from user-confirmed originals.
-- There is no confirmed sequence, referral entitlement or MemoryConfirmed event.
CREATE TABLE automatic_memory_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES memory_account_write_gates(account_id), person_id uuid NOT NULL,
 source_kind text NOT NULL CHECK(source_kind IN ('profile','message')), source_id uuid NOT NULL,
 source_version integer NOT NULL CHECK(source_version>0), state text NOT NULL CHECK(state IN ('active','removed','blocked')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), source_created_at timestamptz(3) NOT NULL, source_sequence bigint CHECK(source_sequence>0),
 last_event_at timestamptz(3) NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 removed_at timestamptz(3), UNIQUE(account_id,person_id,source_kind,source_id), UNIQUE(account_id,person_id,id),
 CHECK(created_at<=updated_at), CHECK((state='removed')=(removed_at IS NOT NULL))
);
CREATE TABLE automatic_memory_receipts (
 origin text NOT NULL CHECK(origin IN ('people','conversations')), event_id uuid NOT NULL,
 account_id uuid NOT NULL REFERENCES memory_account_write_gates(account_id), person_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 outcome text NOT NULL CHECK(outcome IN ('accepted','stale','ineligible','removed')),
 received_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(origin,event_id)
);
CREATE TABLE automatic_memory_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL, person_id uuid NOT NULL, source_record_id uuid NOT NULL,
 source_kind text NOT NULL CHECK(source_kind IN ('profile','message')), source_id uuid NOT NULL,
 source_version integer NOT NULL CHECK(source_version>0), source_created_at timestamptz(3) NOT NULL, source_sequence bigint CHECK(source_sequence>0),
 context_refs jsonb NOT NULL CHECK(jsonb_typeof(context_refs)='array'), snapshot_hash text NOT NULL CHECK(snapshot_hash ~ '^[a-f0-9]{64}$'),
 person_version integer NOT NULL CHECK(person_version>0), person_access_version integer NOT NULL CHECK(person_access_version>0),
 account_access_version integer NOT NULL CHECK(account_access_version>0), authorization_version integer NOT NULL CHECK(authorization_version>0),
 ai_authorization_version integer NOT NULL CHECK(ai_authorization_version>0),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed','blocked')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), dispatch_id uuid NOT NULL, dispatch_generation integer NOT NULL DEFAULT 1 CHECK(dispatch_generation>0),
 attempt_id uuid, attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3), lease_until timestamptz(3),
 failure_code text, retryable boolean NOT NULL DEFAULT false, entry_count integer NOT NULL DEFAULT 0 CHECK(entry_count BETWEEN 0 AND 6),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 queued_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), run_after timestamptz(3) NOT NULL DEFAULT clock_timestamp(), started_at timestamptz(3), finished_at timestamptz(3),
 FOREIGN KEY(account_id,person_id,source_record_id) REFERENCES automatic_memory_sources(account_id,person_id,id), UNIQUE(account_id,person_id,id),
 UNIQUE(source_record_id,source_version,snapshot_hash,ai_authorization_version),
 CHECK((state='running')=(lease_until IS NOT NULL)), CHECK(state<>'running' OR (attempt_id IS NOT NULL AND started_at IS NOT NULL AND started_at<lease_until)),
 CHECK((state IN ('succeeded','failed','blocked'))=(finished_at IS NOT NULL)), CHECK(NOT retryable OR state='failed'),
 CHECK(created_at<=updated_at), CHECK(queued_at<=run_after), CHECK(finished_at IS NULL OR finished_at>=created_at)
);
CREATE UNIQUE INDEX automatic_memory_one_running_person ON automatic_memory_jobs(account_id,person_id) WHERE state='running';
CREATE INDEX automatic_memory_recoverable_jobs ON automatic_memory_jobs(state,updated_at) WHERE state IN ('queued','running','failed');
CREATE TABLE automatic_memory_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL, person_id uuid NOT NULL,
 source_record_id uuid NOT NULL, generation_job_id uuid NOT NULL, fact_index integer NOT NULL CHECK(fact_index BETWEEN 0 AND 5),
 source_kind text NOT NULL CHECK(source_kind IN ('profile','message')), source_id uuid NOT NULL, source_version integer NOT NULL CHECK(source_version>0),
 source_author text NOT NULL DEFAULT 'self' CHECK(source_author='self'), reality text NOT NULL CHECK(reality IN ('user_reported','user_provided_profile')),
 source_created_at timestamptz(3) NOT NULL, source_sequence bigint CHECK(source_sequence>0), sources jsonb NOT NULL CHECK(jsonb_typeof(sources)='array'),
 topic text NOT NULL CHECK(char_length(topic) BETWEEN 1 AND 120), body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 600),
 evidence text NOT NULL CHECK(char_length(evidence) BETWEEN 1 AND 400), time_description text NOT NULL DEFAULT '' CHECK(char_length(time_description)<=120),
 person_access_version integer NOT NULL CHECK(person_access_version>0), account_access_version integer NOT NULL CHECK(account_access_version>0),
 authorization_version integer NOT NULL CHECK(authorization_version>0), ai_authorization_version integer NOT NULL CHECK(ai_authorization_version>0),
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','superseded','withdrawn')), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 superseded_by uuid, created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 state_changed_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(account_id,person_id,source_record_id) REFERENCES automatic_memory_sources(account_id,person_id,id),
 FOREIGN KEY(account_id,person_id,generation_job_id) REFERENCES automatic_memory_jobs(account_id,person_id,id),
 UNIQUE(account_id,person_id,id), UNIQUE(generation_job_id,fact_index),
 FOREIGN KEY(account_id,person_id,superseded_by) REFERENCES automatic_memory_entries(account_id,person_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((state='superseded')=(superseded_by IS NOT NULL)), CHECK(created_at<=updated_at), CHECK(created_at<=state_changed_at),
 CHECK((source_kind='profile' AND reality='user_provided_profile') OR (source_kind='message' AND reality='user_reported'))
);
CREATE INDEX automatic_memory_visible_person ON automatic_memory_entries(account_id,person_id,source_created_at DESC,id DESC) WHERE state='active';
CREATE TRIGGER automatic_memory_source_account_gate BEFORE INSERT OR UPDATE ON automatic_memory_sources FOR EACH ROW EXECUTE FUNCTION memory_guard_account_write();
CREATE TRIGGER automatic_memory_receipt_account_gate BEFORE INSERT OR UPDATE ON automatic_memory_receipts FOR EACH ROW EXECUTE FUNCTION memory_guard_account_write();
CREATE TRIGGER automatic_memory_job_account_gate BEFORE INSERT OR UPDATE ON automatic_memory_jobs FOR EACH ROW EXECUTE FUNCTION memory_guard_account_write();
CREATE TRIGGER automatic_memory_entry_account_gate BEFORE INSERT OR UPDATE ON automatic_memory_entries FOR EACH ROW EXECUTE FUNCTION memory_guard_account_write();
