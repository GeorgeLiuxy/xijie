CREATE TABLE letters (
 id uuid PRIMARY KEY, account_id uuid NOT NULL, person_id uuid NOT NULL, client_letter_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'), body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 10000),
 reply_mode text NOT NULL CHECK(reply_mode IN ('none','now','next_morning')), time_zone text, reply_at timestamptz(3), reply_job_id uuid,
 account_access_version integer NOT NULL CHECK(account_access_version>0), storage_authorization_version integer NOT NULL CHECK(storage_authorization_version>0),
 story_authorization_version integer CHECK(story_authorization_version>0), reply_authorization_version integer CHECK(reply_authorization_version>0),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), removed_at timestamptz(3),
 UNIQUE(account_id,person_id,client_letter_id), UNIQUE(account_id,person_id,id), UNIQUE(account_id,id),
 CHECK(created_at<=updated_at), CHECK(removed_at IS NULL OR removed_at>=created_at),
 CHECK((reply_mode='none' AND reply_at IS NULL AND reply_job_id IS NULL AND story_authorization_version IS NULL AND reply_authorization_version IS NULL AND time_zone IS NULL)
 OR(reply_mode IN ('now','next_morning') AND reply_at IS NOT NULL AND reply_job_id IS NOT NULL AND story_authorization_version IS NOT NULL AND reply_authorization_version IS NOT NULL AND ((reply_mode='now' AND time_zone IS NULL) OR(reply_mode='next_morning' AND time_zone IS NOT NULL))))
);
CREATE INDEX letters_visible_order ON letters(account_id,person_id,created_at DESC,id DESC) WHERE removed_at IS NULL;
CREATE TABLE letter_reply_jobs (
 id uuid PRIMARY KEY, account_id uuid NOT NULL, person_id uuid NOT NULL, letter_id uuid NOT NULL UNIQUE, source_version integer NOT NULL CHECK(source_version>0),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed','blocked','canceled')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), attempt_id uuid, attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3), lease_until timestamptz(3),
 scheduled_at timestamptz(3) NOT NULL, next_attempt_at timestamptz(3) NOT NULL, failure_code text, retryable boolean NOT NULL DEFAULT false, reply_id uuid,
 person_context_ref jsonb, world_context_ref jsonb, provider_provenance jsonb,
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(account_id,person_id,letter_id) REFERENCES letters(account_id,person_id,id),
 UNIQUE(account_id,person_id,id), UNIQUE(account_id,id), UNIQUE(account_id,person_id,letter_id,id),
 CHECK((state='running')=(lease_until IS NOT NULL)), CHECK((state='running')=(attempt_id IS NOT NULL)),
 CHECK((state='succeeded')=(reply_id IS NOT NULL)), CHECK(state<>'succeeded' OR (person_context_ref IS NOT NULL AND world_context_ref IS NOT NULL AND provider_provenance IS NOT NULL)),
 CHECK(created_at<=updated_at), CHECK(next_attempt_at>=scheduled_at)
);
ALTER TABLE letters ADD CONSTRAINT letters_job_fk FOREIGN KEY(account_id,person_id,id,reply_job_id) REFERENCES letter_reply_jobs(account_id,person_id,letter_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE letter_replies (
 id uuid PRIMARY KEY, account_id uuid NOT NULL, person_id uuid NOT NULL, letter_id uuid NOT NULL UNIQUE, job_id uuid NOT NULL UNIQUE,
 sequence bigint NOT NULL CHECK(sequence>0), body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 4000), created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(account_id,person_id,letter_id,job_id) REFERENCES letter_reply_jobs(account_id,person_id,letter_id,id),
 UNIQUE(account_id,person_id,id), UNIQUE(account_id,person_id,sequence), UNIQUE(account_id,person_id,sequence,id), UNIQUE(account_id,person_id,job_id,id)
);
ALTER TABLE letter_reply_jobs ADD CONSTRAINT letter_jobs_reply_fk FOREIGN KEY(account_id,person_id,id,reply_id) REFERENCES letter_replies(account_id,person_id,job_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE letter_read_cursors (
 account_id uuid NOT NULL, person_id uuid NOT NULL, last_sequence bigint NOT NULL DEFAULT 0 CHECK(last_sequence>=0),
 last_read_sequence bigint NOT NULL DEFAULT 0 CHECK(last_read_sequence>=0 AND last_read_sequence<=last_sequence), last_read_reply_id uuid, read_at timestamptz(3),
 PRIMARY KEY(account_id,person_id),
 CHECK((last_read_sequence=0 AND last_read_reply_id IS NULL AND read_at IS NULL) OR(last_read_sequence>0 AND last_read_reply_id IS NOT NULL AND read_at IS NOT NULL)),
 FOREIGN KEY(account_id,person_id,last_read_sequence,last_read_reply_id) REFERENCES letter_replies(account_id,person_id,sequence,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER letters_erasure BEFORE INSERT OR UPDATE ON letters FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
CREATE TRIGGER letter_jobs_erasure BEFORE INSERT OR UPDATE ON letter_reply_jobs FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
CREATE TRIGGER letter_replies_erasure BEFORE INSERT OR UPDATE ON letter_replies FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
CREATE TRIGGER letter_cursors_erasure BEFORE INSERT OR UPDATE ON letter_read_cursors FOR EACH ROW EXECUTE FUNCTION enforce_account_erasure_fence();
ALTER TABLE letter_reply_jobs ADD CONSTRAINT letter_person_reference CHECK(person_context_ref IS NULL OR COALESCE((
 jsonb_typeof(person_context_ref)='object' AND person_context_ref->>'id'=person_id::text
 AND jsonb_typeof(person_context_ref->'version')='number' AND person_context_ref->>'version' ~ '^[1-9][0-9]{0,9}$'
 AND jsonb_typeof(person_context_ref->'accessVersion')='number' AND person_context_ref->>'accessVersion' ~ '^[1-9][0-9]{0,9}$'
 AND jsonb_typeof(person_context_ref->'worldVersion')='number' AND person_context_ref->>'worldVersion' ~ '^[1-9][0-9]{0,9}$'
 AND person_context_ref->'worldVersion'<=person_context_ref->'version'
 AND person_context_ref->>'worldId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
),false));
ALTER TABLE letter_reply_jobs ADD CONSTRAINT letter_world_reference CHECK(world_context_ref IS NULL OR COALESCE((
 person_context_ref IS NOT NULL AND jsonb_typeof(world_context_ref)='object'
 AND world_context_ref->>'accountId'=account_id::text AND world_context_ref->>'personId'=person_id::text
 AND world_context_ref->>'reality'='virtual' AND world_context_ref->>'branch'='main'
 AND world_context_ref->'personVersion'=person_context_ref->'version'
 AND world_context_ref->'worldVersion'=person_context_ref->'worldVersion' AND world_context_ref->'worldId'=person_context_ref->'worldId'
 AND jsonb_typeof(world_context_ref->'catalogVersion')='number' AND world_context_ref->>'catalogVersion' ~ '^[1-9][0-9]{0,9}$'
 AND world_context_ref->>'revision' ~ '^[a-f0-9]{64}$'
 AND CASE WHEN jsonb_typeof(world_context_ref->'movementIds')='array' THEN jsonb_array_length(world_context_ref->'movementIds')<=8 ELSE false END
),false));
ALTER TABLE letter_reply_jobs ADD CONSTRAINT letter_model_provenance CHECK(provider_provenance IS NULL OR COALESCE((
 jsonb_typeof(provider_provenance)='object' AND provider_provenance->>'provider'='openai' AND provider_provenance->>'promptVersion'='person-letter-replies-v1'
 AND jsonb_typeof(provider_provenance->'model')='string' AND length(provider_provenance->>'model') BETWEEN 1 AND 200
 AND (provider_provenance->'responseId'='null'::jsonb OR(jsonb_typeof(provider_provenance->'responseId')='string' AND length(provider_provenance->>'responseId') BETWEEN 1 AND 300))
),false));
