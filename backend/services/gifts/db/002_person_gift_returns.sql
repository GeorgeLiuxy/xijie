ALTER TABLE gift_deliveries ADD COLUMN return_authorization_version integer CHECK(return_authorization_version>0);
ALTER TABLE gift_deliveries ADD COLUMN story_authorization_version integer CHECK(story_authorization_version>0);
ALTER TABLE gift_deliveries ADD COLUMN return_policy_version text;
ALTER TABLE gift_deliveries ADD CONSTRAINT gift_return_capture CHECK(
 (return_authorization_version IS NULL AND story_authorization_version IS NULL AND return_policy_version IS NULL) OR
 (return_authorization_version IS NOT NULL AND story_authorization_version IS NOT NULL AND return_policy_version IS NOT NULL AND return_policy_version='person-gift-returns-v1'));

CREATE TABLE gift_return_jobs(
 id uuid PRIMARY KEY, account_id uuid NOT NULL, source_delivery_id uuid NOT NULL,
 source_delivery_version integer NOT NULL CHECK(source_delivery_version>0),
 account_access_version integer NOT NULL CHECK(account_access_version>0),
 gift_authorization_version integer NOT NULL CHECK(gift_authorization_version>0),
 story_authorization_version integer NOT NULL CHECK(story_authorization_version>0),
 return_authorization_version integer NOT NULL CHECK(return_authorization_version>0),
 policy_version text NOT NULL CHECK(policy_version='person-gift-returns-v1'),
 person_context jsonb, provider_provenance jsonb, decision text CHECK(decision IN('none','gift')),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','failed','succeeded','blocked')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), attempt_id uuid, attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 lease_until timestamptz(3), retry_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 finished_at timestamptz(3), failure_code text,
 UNIQUE(account_id,id), UNIQUE(account_id,source_delivery_id),UNIQUE(account_id,id,source_delivery_id),
 FOREIGN KEY(account_id,source_delivery_id) REFERENCES gift_deliveries(account_id,id),
 CHECK((state='running')=(attempt_id IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK((state='succeeded')=(decision IS NOT NULL)),
 CHECK(state NOT IN('succeeded','blocked') OR finished_at IS NOT NULL));

CREATE TABLE received_gifts(
 id uuid PRIMARY KEY,account_id uuid NOT NULL,source_delivery_id uuid NOT NULL,generation_job_id uuid NOT NULL,
 person_id uuid NOT NULL,conversation_id uuid NOT NULL,person_snapshot jsonb NOT NULL,gift_snapshot jsonb NOT NULL,
 quantity smallint NOT NULL DEFAULT 1 CHECK(quantity=1),note text NOT NULL CHECK(char_length(note)<=120),
 policy_version text NOT NULL CHECK(policy_version='person-gift-returns-v1'),
 account_access_version integer NOT NULL CHECK(account_access_version>0),gift_authorization_version integer NOT NULL CHECK(gift_authorization_version>0),
 story_authorization_version integer NOT NULL CHECK(story_authorization_version>0),return_authorization_version integer NOT NULL CHECK(return_authorization_version>0),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),opened_at timestamptz(3),placement text CHECK(placement IN('record','space')),
 UNIQUE(account_id,id),UNIQUE(account_id,source_delivery_id),UNIQUE(account_id,generation_job_id),
 FOREIGN KEY(account_id,source_delivery_id) REFERENCES gift_deliveries(account_id,id),
 FOREIGN KEY(account_id,generation_job_id,source_delivery_id) REFERENCES gift_return_jobs(account_id,id,source_delivery_id),
 CHECK((opened_at IS NULL)=(placement IS NULL)));
CREATE INDEX received_gifts_account ON received_gifts(account_id,created_at,id);

CREATE TABLE gift_received_projection_jobs(
 id uuid PRIMARY KEY,account_id uuid NOT NULL,received_gift_id uuid NOT NULL,received_version integer NOT NULL CHECK(received_version>0),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','failed','succeeded','blocked')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),attempt_id uuid,attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 lease_until timestamptz(3),retry_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz(3),failure_code text,
 UNIQUE(account_id,received_gift_id,received_version),FOREIGN KEY(account_id,received_gift_id) REFERENCES received_gifts(account_id,id),
 CHECK((state='running')=(attempt_id IS NOT NULL AND lease_until IS NOT NULL)),CHECK(state NOT IN('succeeded','blocked') OR finished_at IS NOT NULL));

ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_account_id_id_key UNIQUE(account_id,id);
CREATE TABLE gift_notifications(
 id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES gifts_account_write_gates(account_id),
 type text NOT NULL CHECK(type IN('gift_arrived','gift_failed','gift_received')),
 source_event_id uuid NOT NULL,object_id uuid NOT NULL,person_id uuid NOT NULL,
 object_kind text NOT NULL CHECK(object_kind IN('delivery','received_gift')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),read_at timestamptz(3),
 UNIQUE(account_id,id),UNIQUE(account_id,type,source_event_id),FOREIGN KEY(account_id,source_event_id) REFERENCES outbox_events(account_id,id),
 CHECK((type='gift_received')=(object_kind='received_gift')));
CREATE INDEX gift_notifications_account ON gift_notifications(account_id,created_at,id);

CREATE TABLE gift_mutation_receipts(
 account_id uuid NOT NULL REFERENCES gifts_account_write_gates(account_id),acceptance_key uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('open','placement','read')),resource_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),expected_version integer CHECK(expected_version>0),
 result_version integer NOT NULL CHECK(result_version>0),created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,acceptance_key));

CREATE TRIGGER gift_return_jobs_gate BEFORE INSERT OR UPDATE ON gift_return_jobs FOR EACH ROW EXECUTE FUNCTION gifts_write_gate();
CREATE TRIGGER received_gifts_gate BEFORE INSERT OR UPDATE ON received_gifts FOR EACH ROW EXECUTE FUNCTION gifts_write_gate();
CREATE TRIGGER gift_received_projection_jobs_gate BEFORE INSERT OR UPDATE ON gift_received_projection_jobs FOR EACH ROW EXECUTE FUNCTION gifts_write_gate();
CREATE TRIGGER gift_notifications_gate BEFORE INSERT OR UPDATE ON gift_notifications FOR EACH ROW EXECUTE FUNCTION gifts_write_gate();
CREATE TRIGGER gift_mutation_receipts_gate BEFORE INSERT ON gift_mutation_receipts FOR EACH ROW EXECUTE FUNCTION gifts_write_gate();
