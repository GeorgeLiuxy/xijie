-- Each consumer acknowledges exact committed events; no time/sequence watermark
-- can skip an event whose transaction committed out of order.
ALTER TABLE outbox_events ADD CONSTRAINT outbox_account_event_identity UNIQUE(account_id,event_id);
CREATE TABLE automatic_memory_event_acks (
  event_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(account_id,event_id) REFERENCES outbox_events(account_id,event_id) ON DELETE CASCADE
);
CREATE INDEX automatic_memory_acks_account ON automatic_memory_event_acks(account_id);
CREATE INDEX automatic_memory_source_events ON outbox_events(account_id,occurred_at,event_id)
  WHERE type IN ('MessageAccepted.v1','MessageRemoved.v1');

-- Actual references used by a reply are retained independently of future ranking.
ALTER TABLE generation_jobs ADD COLUMN memory_context_refs jsonb NOT NULL DEFAULT '[]'
  CHECK (jsonb_typeof(memory_context_refs)='array');
