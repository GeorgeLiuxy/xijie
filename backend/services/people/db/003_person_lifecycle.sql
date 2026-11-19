ALTER TABLE persons
  ADD COLUMN real_name text CHECK (char_length(real_name) BETWEEN 1 AND 80),
  ADD COLUMN called_me text CHECK (char_length(called_me) BETWEEN 1 AND 80),
  ADD COLUMN birth_month_day text CHECK (
    birth_month_day ~ '^(?:(?:01|03|05|07|08|10|12)-(?:0[1-9]|[12][0-9]|3[01])|(?:04|06|09|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-9]))$'
  ),
  ADD COLUMN years_text text CHECK (char_length(years_text) BETWEEN 1 AND 120),
  ADD COLUMN place text CHECK (char_length(place) BETWEEN 1 AND 200),
  ADD COLUMN access_version integer NOT NULL DEFAULT 1 CHECK (access_version >= 1),
  ADD COLUMN removed_at timestamptz(3),
  ADD CONSTRAINT persons_lifecycle_times CHECK (
    created_at <= updated_at AND (removed_at IS NULL OR (created_at <= removed_at AND removed_at <= updated_at))
  ),
  ADD CONSTRAINT persons_removed_state CHECK ((status = 'removed') = (removed_at IS NOT NULL));

ALTER TABLE person_draft_commands DROP CONSTRAINT person_draft_commands_operation_check;
ALTER TABLE person_draft_commands ADD CONSTRAINT person_draft_commands_operation_check
  CHECK (operation IN ('create', 'update', 'preview', 'confirm', 'person_update', 'person_remove'));
