-- Consumer-local acknowledgements, independent of original confirmation order.
ALTER TABLE outbox_events ADD CONSTRAINT memory_outbox_account_event_identity UNIQUE(account_id,event_id);
CREATE TABLE social_memory_event_acks (
 event_id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES memory_account_write_gates(account_id),
 acknowledged_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(account_id,event_id) REFERENCES outbox_events(account_id,event_id) ON DELETE CASCADE
);
CREATE INDEX social_memory_acks_account ON social_memory_event_acks(account_id);
CREATE INDEX social_memory_source_events ON outbox_events(account_id,occurred_at,event_id)
 WHERE type IN ('MemoryConfirmed.v1','MemoryUpdated.v1','MemoryRemoved.v1');
CREATE TRIGGER social_memory_ack_account_gate BEFORE INSERT OR UPDATE ON social_memory_event_acks
 FOR EACH ROW EXECUTE FUNCTION memory_guard_account_write();
