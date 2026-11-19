ALTER TABLE memories DROP CONSTRAINT memories_origin_check;
ALTER TABLE memories ADD CONSTRAINT memories_origin_check CHECK(origin IN ('manual','ai_candidate','shared_contribution','import'));
ALTER TABLE memories ADD CONSTRAINT memory_import_not_inferred CHECK(origin<>'import' OR (source_message_id IS NULL AND candidate_id IS NULL));
CREATE TABLE memory_import_batches(
 account_id uuid NOT NULL REFERENCES memory_account_cursors(account_id),id uuid NOT NULL,person_id uuid NOT NULL,
 idempotency_key uuid NOT NULL,request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),person_version integer NOT NULL CHECK(person_version>0),
 item_count integer NOT NULL CHECK(item_count BETWEEN 1 AND 50),character_count integer NOT NULL CHECK(character_count BETWEEN 1 AND 100000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(account_id,id),UNIQUE(account_id,id,person_id),UNIQUE(account_id,idempotency_key)
);
CREATE TABLE memory_import_items(
 account_id uuid NOT NULL,batch_id uuid NOT NULL,person_id uuid NOT NULL,item_id uuid NOT NULL,memory_id uuid NOT NULL,
 PRIMARY KEY(account_id,batch_id,item_id),UNIQUE(account_id,item_id),UNIQUE(account_id,memory_id),
 FOREIGN KEY(account_id,batch_id,person_id) REFERENCES memory_import_batches(account_id,id,person_id),
 FOREIGN KEY(account_id,person_id,memory_id) REFERENCES memories(account_id,person_id,id)
);
CREATE TRIGGER memory_import_batch_gate BEFORE INSERT OR UPDATE ON memory_import_batches FOR EACH ROW EXECUTE FUNCTION memory_guard_account_write();
CREATE TRIGGER memory_import_item_gate BEFORE INSERT OR UPDATE ON memory_import_items FOR EACH ROW EXECUTE FUNCTION memory_guard_account_write();
CREATE FUNCTION memory_import_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' OR NOT EXISTS(SELECT 1 FROM memory_account_write_gates WHERE account_id=OLD.account_id AND erased_at IS NOT NULL) THEN RAISE EXCEPTION 'Import receipts are permanent until account erasure.' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END; $$;
CREATE TRIGGER memory_import_batch_immutable BEFORE UPDATE OR DELETE ON memory_import_batches FOR EACH ROW EXECUTE FUNCTION memory_import_receipt_immutable();
CREATE TRIGGER memory_import_item_immutable BEFORE UPDATE OR DELETE ON memory_import_items FOR EACH ROW EXECUTE FUNCTION memory_import_receipt_immutable();
CREATE FUNCTION memory_import_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked boolean; origin_value text; client_id uuid;
BEGIN
 IF TG_TABLE_NAME='memories' THEN
  SELECT EXISTS(SELECT 1 FROM memory_import_items WHERE account_id=NEW.account_id AND memory_id=NEW.id) INTO linked;
  IF (NEW.origin='import')<>linked THEN RAISE EXCEPTION 'Import provenance must match its receipt.' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT origin,client_memory_id INTO origin_value,client_id FROM memories WHERE account_id=NEW.account_id AND person_id=NEW.person_id AND id=NEW.memory_id;
  IF origin_value IS DISTINCT FROM 'import' OR client_id IS DISTINCT FROM NEW.item_id THEN RAISE EXCEPTION 'Import item must identify its imported memory.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER memory_import_original_provenance AFTER INSERT OR UPDATE ON memories DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION memory_import_provenance();
CREATE CONSTRAINT TRIGGER memory_import_item_provenance AFTER INSERT ON memory_import_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION memory_import_provenance();
