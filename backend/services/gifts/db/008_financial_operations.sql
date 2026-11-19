CREATE TABLE financial_retention_records(
 id uuid PRIMARY KEY,account_id uuid NOT NULL UNIQUE REFERENCES gifts_account_write_gates(account_id),request_id uuid NOT NULL,
 policy_version text NOT NULL CHECK(policy_version~'^[-a-zA-Z0-9._]{1,80}$'),retention_days integer NOT NULL CHECK(retention_days BETWEEN 1 AND 36500),
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),retain_until timestamptz(3) NOT NULL,
 payload jsonb NOT NULL,payload_hash text NOT NULL CHECK(payload_hash~'^[a-f0-9]{64}$'),recovery_blocked boolean NOT NULL DEFAULT false,CHECK(retain_until>created_at)
);
ALTER TABLE commerce_reconciliation_jobs ADD COLUMN recovery_blocked boolean NOT NULL DEFAULT false;
ALTER TABLE gifts_erase_receipts ADD COLUMN financial_retention jsonb NOT NULL DEFAULT '{"status":"none"}';
CREATE TABLE commerce_operator_commands(
 id uuid PRIMARY KEY,account_id uuid REFERENCES gifts_account_write_gates(account_id),order_id uuid,kind text CHECK(kind IN('payment','refund')),resource_id uuid,deletion_request_id uuid,
 action text NOT NULL CHECK(action IN('read','recheck','refund_approve','refund_reject','cancel_unstarted','purge_retention','retention_read')),
 reviewer text NOT NULL CHECK(length(reviewer) BETWEEN 1 AND 80),reason_code text NOT NULL CHECK(reason_code~'^[-a-zA-Z0-9._]{1,80}$'),
 request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),ordinal integer CHECK(ordinal BETWEEN 1 AND 10),
 state text NOT NULL CHECK(state IN('running','succeeded','blocked')),lease_until timestamptz(3),result_code text,
 created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz(3),applied_txid bigint NOT NULL DEFAULT txid_current(),
 CHECK((state='running')=(lease_until IS NOT NULL)),CHECK((action='recheck')=(ordinal IS NOT NULL)),
 CHECK((action='purge_retention')=(account_id IS NULL AND order_id IS NULL AND resource_id IS NULL AND kind IS NULL))
);
CREATE UNIQUE INDEX commerce_operator_check_ordinal ON commerce_operator_commands(kind,resource_id,ordinal) WHERE action='recheck';
CREATE FUNCTION protect_financial_retention() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF TG_OP='UPDATE' THEN IF NOT OLD.recovery_blocked AND NEW.recovery_blocked AND(to_jsonb(NEW)-'recovery_blocked')=(to_jsonb(OLD)-'recovery_blocked') THEN RETURN NEW;END IF;RAISE EXCEPTION 'financial retention snapshot is immutable' USING ERRCODE='42501';END IF;
 IF OLD.recovery_blocked OR OLD.retain_until>clock_timestamp() OR NOT EXISTS(SELECT 1 FROM gifts_account_write_gates WHERE account_id=OLD.account_id AND erased_at IS NOT NULL) THEN RAISE EXCEPTION 'financial retention is not due for purge' USING ERRCODE='42501';END IF;RETURN OLD;END$$;
CREATE TRIGGER financial_retention_immutable BEFORE UPDATE OR DELETE ON financial_retention_records FOR EACH ROW EXECUTE FUNCTION protect_financial_retention();
CREATE FUNCTION protect_commerce_operator_command() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.account_id IS NOT NULL AND EXISTS(SELECT 1 FROM gifts_account_write_gates WHERE account_id=OLD.account_id AND erased_at IS NOT NULL) THEN RETURN OLD;END IF;
  RAISE EXCEPTION 'operator audit requires account erasure' USING ERRCODE='42501';
 END IF;
 IF OLD.state<>'running' OR(to_jsonb(NEW)-ARRAY['state','lease_until','result_code','finished_at'])<>(to_jsonb(OLD)-ARRAY['state','lease_until','result_code','finished_at']) THEN RAISE EXCEPTION 'operator acceptance is immutable' USING ERRCODE='42501';END IF;RETURN NEW;END$$;
CREATE TRIGGER commerce_operator_audit_immutable BEFORE UPDATE OR DELETE ON commerce_operator_commands FOR EACH ROW EXECUTE FUNCTION protect_commerce_operator_command();

CREATE OR REPLACE FUNCTION protect_commerce_fact() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE mutable text[];BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM gifts_account_write_gates WHERE account_id=OLD.account_id AND erased_at IS NOT NULL) THEN RETURN OLD;END IF;
  RAISE EXCEPTION 'commerce facts require account erasure' USING ERRCODE='42501';
 END IF;
 mutable=CASE TG_TABLE_NAME
 WHEN 'commerce_orders' THEN ARRAY['payment_state','fulfillment_state','credit_transaction_id','paid_at','closed_at','version','updated_at']
 WHEN 'commerce_payment_attempts' THEN ARRAY['state','started_at','finished_at','updated_at','launch_url','launch_expires_at']
 WHEN 'commerce_refunds' THEN ARRAY['state','debit_transaction_id','started_at','finished_at','failure_code','updated_at']
 WHEN 'commerce_refund_reservations' THEN ARRAY['state','updated_at']
 WHEN 'commerce_reconciliation_jobs' THEN ARRAY['state','version','attempt_id','lease_until','attempt_count','error_count','retry_at','failure_code','updated_at','finished_at','recovery_blocked'] END;
 IF(to_jsonb(NEW)-mutable)<>(to_jsonb(OLD)-mutable) THEN RAISE EXCEPTION 'commerce acceptance is immutable' USING ERRCODE='42501';END IF;
 IF TG_TABLE_NAME='commerce_orders' THEN
  IF OLD.payment_state IN('paid','closed') AND NEW.payment_state<>OLD.payment_state THEN RAISE EXCEPTION 'terminal order' USING ERRCODE='42501';END IF;
 END IF;
 IF TG_TABLE_NAME IN('commerce_payment_attempts','commerce_refunds','commerce_refund_reservations') THEN
  IF OLD.state IN('succeeded','failed','closed','refunded','review','released','captured') AND NEW.state<>OLD.state THEN
   IF TG_TABLE_NAME<>'commerce_refunds' THEN RAISE EXCEPTION 'terminal commerce resource' USING ERRCODE='42501';END IF;
   IF OLD.state<>'review' OR NOT EXISTS(SELECT 1 FROM commerce_operator_commands c WHERE c.account_id=OLD.account_id AND c.resource_id=OLD.id AND c.kind='refund' AND c.state='running' AND c.applied_txid=txid_current() AND ((NEW.state='reserved' AND c.action='refund_approve') OR (NEW.state='failed' AND c.action='refund_reject'))) THEN RAISE EXCEPTION 'refund review requires audited decision' USING ERRCODE='42501';END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME IN('commerce_payment_attempts','commerce_refunds') THEN
  IF OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at THEN RAISE EXCEPTION 'outbound operation already dispatched' USING ERRCODE='42501';END IF;
 END IF;
 IF TG_TABLE_NAME='commerce_payment_attempts' THEN
  IF OLD.launch_url IS NOT NULL AND (NEW.launch_url IS DISTINCT FROM OLD.launch_url OR NEW.launch_expires_at IS DISTINCT FROM OLD.launch_expires_at) THEN
   RAISE EXCEPTION 'payment launch is immutable' USING ERRCODE='42501';
  END IF;
 END IF;
 IF TG_TABLE_NAME='commerce_reconciliation_jobs' THEN
  IF OLD.recovery_blocked AND NOT NEW.recovery_blocked THEN RAISE EXCEPTION 'restored financial operation is blocked' USING ERRCODE='42501';END IF;
  IF NEW.attempt_count<OLD.attempt_count OR NEW.attempt_count>OLD.attempt_count+1 OR NEW.error_count<OLD.error_count OR NEW.error_count>OLD.error_count+1 THEN RAISE EXCEPTION 'reconciliation budget is monotonic' USING ERRCODE='42501';END IF;
 END IF;RETURN NEW;END$$;
