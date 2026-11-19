CREATE TABLE call_sessions(
 id uuid PRIMARY KEY,account_id uuid NOT NULL,conversation_id uuid NOT NULL,person_id uuid NOT NULL,session_id uuid NOT NULL,
 mode text NOT NULL DEFAULT 'voice' CHECK(mode='voice'),state text NOT NULL DEFAULT 'created' CHECK(state IN('created','connecting','connected','ending','ended','failed','expired')),
 person_version integer NOT NULL,person_access_version integer NOT NULL,account_access_version integer NOT NULL,storage_version integer NOT NULL,voice_version integer NOT NULL,production_version integer,
 idempotency_key uuid NOT NULL,version integer NOT NULL DEFAULT 1,max_seconds integer NOT NULL CHECK(max_seconds BETWEEN 1 AND 120),
 provider text NOT NULL DEFAULT 'openai-realtime',model text NOT NULL,voice text NOT NULL DEFAULT 'marin' CHECK(voice IN('marin','coral','cedar')),provider_session_id text,
 attempt_id uuid,server_owner uuid,lease_until timestamptz(3),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz(3) NOT NULL,started_at timestamptz(3),ended_at timestamptz(3),
 failure_code text,stop_reason text,updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,idempotency_key),FOREIGN KEY(account_id,conversation_id) REFERENCES conversations(account_id,id),
 CHECK(ended_at IS NULL OR started_at IS NOT NULL AND ended_at>=started_at)
);
CREATE UNIQUE INDEX one_active_call_per_account ON call_sessions(account_id) WHERE state IN('created','connecting','connected','ending');
CREATE INDEX calls_by_owner_time ON call_sessions(account_id,created_at);
CREATE INDEX calls_by_conversation_end ON call_sessions(account_id,conversation_id,ended_at DESC,id DESC) WHERE state='ended' AND started_at IS NOT NULL AND ended_at IS NOT NULL;
CREATE TABLE call_grants(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),account_id uuid NOT NULL,call_id uuid NOT NULL REFERENCES call_sessions(id),
 idempotency_key uuid NOT NULL,token_hash text NOT NULL UNIQUE,token_cipher bytea NOT NULL,expires_at timestamptz(3) NOT NULL,used_at timestamptz(3),
 UNIQUE(account_id,call_id,idempotency_key)
);
