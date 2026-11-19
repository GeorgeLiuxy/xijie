CREATE TABLE person_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  display_name text CHECK (char_length(display_name) BETWEEN 1 AND 80),
  relationship text CHECK (char_length(relationship) BETWEEN 1 AND 40),
  story text CHECK (char_length(story) BETWEEN 1 AND 20000),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  authorization_version integer NOT NULL CHECK (authorization_version >= 1),
  created_at timestamptz(3) NOT NULL,
  updated_at timestamptz(3) NOT NULL,
  expires_at timestamptz(3) NOT NULL,
  CHECK (created_at <= updated_at AND updated_at < expires_at),
  UNIQUE (account_id, id)
);

CREATE INDEX person_drafts_account_order
  ON person_drafts (account_id, updated_at DESC, id DESC);

CREATE TABLE person_draft_commands (
  account_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('create', 'update')),
  target text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK (char_length(request_hash) = 64),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (account_id, operation, target, idempotency_key)
);

CREATE INDEX person_draft_commands_retention
  ON person_draft_commands (created_at);
