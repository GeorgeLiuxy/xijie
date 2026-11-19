-- Optional for older completed rows and calls without trustworthy telemetry.
ALTER TABLE model_executions ADD COLUMN usage jsonb
  CHECK (usage IS NULL OR (finished_at IS NOT NULL AND jsonb_typeof(usage) = 'object'));

CREATE INDEX model_executions_account_usage ON model_executions(account_id, claimed_at, id)
  WHERE usage IS NOT NULL;
