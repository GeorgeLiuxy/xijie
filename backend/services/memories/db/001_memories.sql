CREATE TABLE memory_account_cursors (
 account_id uuid PRIMARY KEY, last_confirmed_seq bigint NOT NULL DEFAULT 0 CHECK(last_confirmed_seq>=0),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 CHECK(created_at<=updated_at)
);
CREATE TABLE memories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES memory_account_cursors(account_id), person_id uuid NOT NULL,
 client_memory_id uuid NOT NULL, request_hash text NOT NULL, confirmed_seq bigint NOT NULL CHECK(confirmed_seq>0),
 origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120), body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 10000),
 source_message_id uuid, source_message_version integer, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), confirmed_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), removed_at timestamptz(3),
 UNIQUE(account_id,person_id,client_memory_id), UNIQUE(account_id,confirmed_seq), UNIQUE(account_id,person_id,id),
 CHECK((source_message_id IS NULL)=(source_message_version IS NULL)), CHECK(source_message_version IS NULL OR source_message_version>0),
 CHECK(created_at<=updated_at), CHECK(confirmed_at<=updated_at), CHECK(removed_at IS NULL OR removed_at>=confirmed_at)
);
CREATE INDEX memories_visible_person ON memories(account_id,person_id,confirmed_at DESC,id DESC) WHERE removed_at IS NULL;
CREATE INDEX memories_visible_account ON memories(account_id,confirmed_seq DESC) WHERE removed_at IS NULL;
CREATE TABLE memory_commands (
 account_id uuid NOT NULL REFERENCES memory_account_cursors(account_id), operation text NOT NULL, target text NOT NULL, idempotency_key uuid NOT NULL,
 request_hash text NOT NULL, response jsonb NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz(3) NOT NULL DEFAULT (clock_timestamp()+interval '7 days'),
 PRIMARY KEY(account_id,operation,target,idempotency_key), CHECK(created_at<expires_at)
);
CREATE TABLE outbox_events (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL, schema_version integer NOT NULL DEFAULT 1,
 account_id uuid NOT NULL, aggregate_type text NOT NULL, aggregate_id uuid NOT NULL, aggregate_version integer NOT NULL,
 occurred_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), request_id uuid NOT NULL, payload jsonb NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), dispatched_at timestamptz, next_retry_at timestamptz,
 UNIQUE(type,aggregate_id,aggregate_version)
);
