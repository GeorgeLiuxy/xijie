CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL, person_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'direct' CHECK (kind='direct'), status text NOT NULL DEFAULT 'active' CHECK (status='active'),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK(last_sequence>=0), version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(account_id,person_id), UNIQUE(account_id,id), CHECK(created_at<=updated_at)
);
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL, conversation_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK(sequence>0), author_kind text NOT NULL CHECK(author_kind IN ('self','persona')),
  text text NOT NULL CHECK(char_length(text) BETWEEN 1 AND 4000), client_message_id uuid,
  reply_to_message_id uuid, generation_job_id uuid, speaker_person_id uuid, display_name text,
  request_hash text, version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), removed_at timestamptz(3),
  FOREIGN KEY(account_id,conversation_id) REFERENCES conversations(account_id,id),
  UNIQUE(account_id,conversation_id,id), UNIQUE(conversation_id,sequence), UNIQUE(conversation_id,client_message_id),
  CHECK((author_kind='self')=(client_message_id IS NOT NULL)),
  CHECK(author_kind<>'persona' OR (reply_to_message_id IS NOT NULL AND generation_job_id IS NOT NULL AND speaker_person_id IS NOT NULL AND display_name IS NOT NULL)),
  CHECK(removed_at IS NULL OR removed_at>=created_at)
);
CREATE INDEX messages_visible_order ON messages(account_id,conversation_id,sequence DESC) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX messages_one_reply_per_job ON messages(generation_job_id) WHERE author_kind='persona';
CREATE TABLE generation_jobs (
  id uuid PRIMARY KEY, account_id uuid NOT NULL, conversation_id uuid NOT NULL, person_id uuid NOT NULL,
  source_message_id uuid NOT NULL UNIQUE, kind text NOT NULL DEFAULT 'chat_reply' CHECK(kind='chat_reply'),
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','succeeded','failed','blocked','canceled')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0), attempt_id uuid, attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
  lease_until timestamptz(3), failure_code text, retryable boolean NOT NULL DEFAULT false, reply_id uuid,
  person_version integer NOT NULL CHECK(person_version>0), person_access_version integer NOT NULL CHECK(person_access_version>0),
  account_access_version integer NOT NULL CHECK(account_access_version>0), authorization_version integer NOT NULL CHECK(authorization_version>0),
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(account_id,conversation_id,source_message_id) REFERENCES messages(account_id,conversation_id,id),
  UNIQUE(account_id,id), CHECK((state='running')=(lease_until IS NOT NULL)), CHECK(created_at<=updated_at),
  CHECK((state='succeeded')=(reply_id IS NOT NULL))
);
ALTER TABLE messages ADD CONSTRAINT messages_job_fk FOREIGN KEY(account_id,generation_job_id) REFERENCES generation_jobs(account_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE messages ADD CONSTRAINT messages_reply_fk FOREIGN KEY(account_id,conversation_id,reply_to_message_id) REFERENCES messages(account_id,conversation_id,id);
ALTER TABLE generation_jobs ADD CONSTRAINT jobs_reply_fk FOREIGN KEY(account_id,conversation_id,reply_id) REFERENCES messages(account_id,conversation_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE conversation_commands (
 account_id uuid NOT NULL, operation text NOT NULL, target text NOT NULL, idempotency_key uuid NOT NULL,
 request_hash text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,operation,target,idempotency_key)
);
CREATE TABLE outbox_events (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL, schema_version integer NOT NULL DEFAULT 1,
 account_id uuid NOT NULL, aggregate_type text NOT NULL, aggregate_id uuid NOT NULL, aggregate_version integer NOT NULL,
 occurred_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), request_id uuid NOT NULL, payload jsonb NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), dispatched_at timestamptz, next_retry_at timestamptz,
 UNIQUE(type,aggregate_id,aggregate_version)
);
