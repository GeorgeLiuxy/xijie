ALTER TABLE memories DROP CONSTRAINT memories_origin_check;
ALTER TABLE memories ADD CONSTRAINT memories_origin_check CHECK(origin IN ('manual','ai_candidate','shared_contribution'));
ALTER TABLE memories ADD COLUMN source_album_id uuid;
ALTER TABLE memories ADD COLUMN source_contribution_id uuid;
ALTER TABLE memories ADD COLUMN source_contribution_version integer;
ALTER TABLE memories ADD CONSTRAINT memory_shared_source CHECK(
 (origin='shared_contribution' AND source_album_id IS NOT NULL AND source_contribution_id IS NOT NULL AND source_contribution_version IS NOT NULL AND source_contribution_version>0 AND source_message_id IS NULL AND candidate_id IS NULL)
 OR (origin<>'shared_contribution' AND source_album_id IS NULL AND source_contribution_id IS NULL AND source_contribution_version IS NULL));
CREATE UNIQUE INDEX memory_shared_source_once ON memories(account_id,source_contribution_id) WHERE source_contribution_id IS NOT NULL;
CREATE TABLE shared_memory_receipts (
 account_id uuid NOT NULL, album_id uuid NOT NULL, contribution_id uuid NOT NULL,
 source_version integer, person_id uuid, memory_id uuid, state text NOT NULL CHECK(state IN ('fulfilled','revoked')),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,contribution_id), CHECK(source_version IS NULL OR source_version>0), CHECK(state='revoked' OR source_version IS NOT NULL AND source_version>0 AND person_id IS NOT NULL AND memory_id IS NOT NULL)
);
CREATE TRIGGER shared_memory_account_gate BEFORE INSERT OR UPDATE ON shared_memory_receipts FOR EACH ROW EXECUTE FUNCTION memory_guard_account_write();
