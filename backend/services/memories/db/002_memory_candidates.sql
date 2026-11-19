CREATE TABLE memory_generation_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES memory_account_cursors(account_id), person_id uuid NOT NULL,
 source_message_id uuid NOT NULL, source_version integer NOT NULL CHECK(source_version>0), context_refs jsonb NOT NULL CHECK(jsonb_typeof(context_refs)='array'),
 person_version integer NOT NULL CHECK(person_version>0), person_access_version integer NOT NULL CHECK(person_access_version>0), account_access_version integer NOT NULL CHECK(account_access_version>0), authorization_version integer NOT NULL CHECK(authorization_version>0),
 kind text NOT NULL DEFAULT 'memory_suggestion' CHECK(kind='memory_suggestion'), state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed','blocked','canceled')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), dispatch_id uuid NOT NULL, dispatch_generation integer NOT NULL DEFAULT 1 CHECK(dispatch_generation>0),
 attempt_id uuid, attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3), lease_until timestamptz(3),
 failure_code text, retryable boolean NOT NULL DEFAULT false, candidate_id uuid,
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 queued_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), run_after timestamptz(3) NOT NULL DEFAULT clock_timestamp(), started_at timestamptz(3), finished_at timestamptz(3),
 UNIQUE(account_id,id), UNIQUE(account_id,person_id,id),
 CHECK((state='running')=(lease_until IS NOT NULL)), CHECK(state<>'running' OR (attempt_id IS NOT NULL AND started_at IS NOT NULL AND started_at<lease_until)),
 CHECK((state IN ('succeeded','failed','blocked','canceled'))=(finished_at IS NOT NULL)), CHECK((state='succeeded')=(candidate_id IS NOT NULL)),
 CHECK(NOT retryable OR state='failed'), CHECK(created_at<=updated_at), CHECK(queued_at<=run_after), CHECK(finished_at IS NULL OR finished_at>=created_at)
);
CREATE UNIQUE INDEX memory_jobs_one_active_source ON memory_generation_jobs(account_id,person_id,source_message_id,source_version) WHERE state IN ('queued','running');
CREATE INDEX memory_jobs_source_history ON memory_generation_jobs(account_id,person_id,source_message_id,source_version,created_at DESC,id DESC);
CREATE INDEX memory_jobs_recovery ON memory_generation_jobs(state,updated_at) WHERE state IN ('queued','running');
CREATE TABLE memory_candidates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL, person_id uuid NOT NULL, generation_job_id uuid NOT NULL UNIQUE,
 source_message_id uuid NOT NULL, source_version integer NOT NULL CHECK(source_version>0), context_refs jsonb NOT NULL CHECK(jsonb_typeof(context_refs)='array'),
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120), body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 10000),
 state text NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','consumed','expired','withdrawn')), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz(3) NOT NULL,
 state_changed_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), consumed_at timestamptz(3),
 FOREIGN KEY(account_id,person_id,generation_job_id) REFERENCES memory_generation_jobs(account_id,person_id,id), UNIQUE(account_id,person_id,id),
 CHECK(created_at<expires_at), CHECK(created_at<=state_changed_at), CHECK((state='consumed')=(consumed_at IS NOT NULL))
);
CREATE UNIQUE INDEX memory_candidates_one_ready_source ON memory_candidates(account_id,person_id,source_message_id,source_version) WHERE state='ready';
ALTER TABLE memory_generation_jobs ADD CONSTRAINT memory_jobs_candidate_fk FOREIGN KEY(account_id,person_id,candidate_id) REFERENCES memory_candidates(account_id,person_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE candidate_commands (
 account_id uuid NOT NULL REFERENCES memory_account_cursors(account_id), operation text NOT NULL, target text NOT NULL, idempotency_key uuid NOT NULL,
 request_hash text NOT NULL, response jsonb NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,operation,target,idempotency_key)
);
ALTER TABLE memories DROP CONSTRAINT memories_origin_check;
ALTER TABLE memories ADD COLUMN candidate_id uuid;
ALTER TABLE memories ADD CONSTRAINT memories_origin_check CHECK(origin IN ('manual','ai_candidate'));
ALTER TABLE memories ADD CONSTRAINT memories_candidate_origin_check CHECK((origin='ai_candidate')=(candidate_id IS NOT NULL));
ALTER TABLE memories ADD CONSTRAINT memories_candidate_fk FOREIGN KEY(account_id,person_id,candidate_id) REFERENCES memory_candidates(account_id,person_id,id);
CREATE UNIQUE INDEX memories_one_candidate ON memories(account_id,person_id,candidate_id) WHERE candidate_id IS NOT NULL;
