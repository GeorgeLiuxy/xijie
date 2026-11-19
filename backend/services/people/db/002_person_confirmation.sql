CREATE TABLE worlds (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  catalog_version integer NOT NULL DEFAULT 1 CHECK (catalog_version >= 1)
);

INSERT INTO worlds (id, code, display_name) VALUES
  ('0d700000-0000-4000-8000-000000000001', 'courtyard', '日光庭院'),
  ('0d700000-0000-4000-8000-000000000002', 'tide', '潮汐回廊'),
  ('0d700000-0000-4000-8000-000000000003', 'isles', '折光星屿');

ALTER TABLE person_drafts ADD COLUMN confirmed_at timestamptz(3);

CREATE TABLE person_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  draft_id uuid NOT NULL,
  draft_version integer NOT NULL CHECK (draft_version >= 1),
  authorization_version integer NOT NULL CHECK (authorization_version >= 1),
  suggested_world_id uuid NOT NULL REFERENCES worlds (id),
  created_at timestamptz(3) NOT NULL,
  expires_at timestamptz(3) NOT NULL,
  invalidated_at timestamptz(3),
  CHECK (expires_at > created_at),
  UNIQUE (account_id, draft_id, id),
  FOREIGN KEY (account_id, draft_id) REFERENCES person_drafts (account_id, id)
);

CREATE UNIQUE INDEX person_previews_current_draft
  ON person_previews (account_id, draft_id) WHERE invalidated_at IS NULL;

CREATE TABLE persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  source_draft_id uuid NOT NULL,
  source_preview_id uuid NOT NULL,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  relationship text NOT NULL CHECK (char_length(relationship) BETWEEN 1 AND 40),
  story text NOT NULL CHECK (char_length(story) BETWEEN 1 AND 20000),
  world_id uuid NOT NULL REFERENCES worlds (id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz(3) NOT NULL,
  updated_at timestamptz(3) NOT NULL,
  UNIQUE (account_id, id),
  UNIQUE (account_id, source_draft_id),
  FOREIGN KEY (account_id, source_draft_id, source_preview_id)
    REFERENCES person_previews (account_id, draft_id, id)
);

CREATE INDEX persons_account_order ON persons (account_id, updated_at DESC, id DESC)
  WHERE status = 'active';

CREATE TABLE outbox_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  account_id uuid NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version integer NOT NULL CHECK (aggregate_version >= 1),
  occurred_at timestamptz(3) NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  payload jsonb NOT NULL,
  dispatched_at timestamptz,
  next_retry_at timestamptz,
  UNIQUE (type, aggregate_id, aggregate_version)
);

ALTER TABLE person_draft_commands DROP CONSTRAINT person_draft_commands_operation_check;
ALTER TABLE person_draft_commands ADD CONSTRAINT person_draft_commands_operation_check
  CHECK (operation IN ('create', 'update', 'preview', 'confirm'));
